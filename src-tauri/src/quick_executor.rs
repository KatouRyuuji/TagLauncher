//! Single owner for platform window work. UI submits; it never waits for this worker.
use std::cell::Cell;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};

thread_local! {
    static CURRENT: Cell<u64> = const { Cell::new(0) };
    static PAUSED: Cell<Option<u64>> = const { Cell::new(None) };
}
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
type Job = Box<dyn FnOnce() + Send + 'static>;
enum Message {
    Run(Job),
    Resume(u64, Job),
    #[cfg(test)]
    Fence(Sender<()>),
}
#[derive(Clone)]
pub struct Executor {
    id: u64,
    tx: Sender<Message>,
}
impl Executor {
    pub fn new() -> Self {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("tl-quick-lifecycle".into())
            .spawn(move || {
                CURRENT.set(id);
                let mut pending = VecDeque::new();
                while let Ok(message) = rx.recv() {
                    match message {
                        Message::Run(job) => pending.push_back(job),
                        Message::Resume(token, done) => {
                            if PAUSED.get() == Some(token) {
                                done();
                                PAUSED.set(None);
                            }
                        }
                        #[cfg(test)]
                        Message::Fence(tx) => {
                            let _ = tx.send(());
                        }
                    }
                    while PAUSED.get().is_none() {
                        let Some(job) = pending.pop_front() else {
                            break;
                        };
                        job();
                    }
                }
            })
            .expect("quick lifecycle worker");
        Self { id, tx }
    }
    pub fn is_current(&self) -> bool {
        CURRENT.get() == self.id
    }
    pub fn defer(&self, job: impl FnOnce() + Send + 'static) -> Result<(), String> {
        // Always queue, including from this worker, so FIFO cancellation is not bypassed.
        self.tx
            .send(Message::Run(Box::new(job)))
            .map_err(|_| "快速窗生命周期已结束".into())
    }
    pub fn defer_guarded(
        &self,
        still_owned: impl FnOnce() -> bool + Send + 'static,
        job: impl FnOnce() + Send + 'static,
    ) -> Result<(), String> {
        self.defer(move || {
            if still_owned() {
                job();
            }
        })
    }
    pub fn call<T: Send + 'static>(
        &self,
        job: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, String> {
        if self.is_current() {
            return Ok(job());
        }
        let (tx, rx) = mpsc::sync_channel(1);
        self.defer(move || {
            let _ = tx.send(job());
        })?;
        rx.recv().map_err(|_| "快速窗生命周期任务已取消".into())
    }
    pub fn pause(&self, token: u64) {
        assert!(self.is_current());
        PAUSED.set(Some(token));
    }
    pub fn resume(&self, token: u64, done: impl FnOnce() + Send + 'static) {
        let _ = self.tx.send(Message::Resume(token, Box::new(done)));
    }
    #[cfg(test)]
    fn fence(&self) {
        let (tx, rx) = mpsc::channel();
        self.tx.send(Message::Fence(tx)).unwrap();
        rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
    }
}

/// Commit a state decision under its owner lock; platform work belongs after return.
pub fn commit_if_idle<S, T>(
    state: &std::sync::Mutex<S>,
    idle: impl FnOnce(&S) -> bool,
    commit: impl FnOnce() -> T,
) -> Option<T> {
    let guard = state.lock().unwrap_or_else(|e| e.into_inner());
    if !idle(&guard) {
        return None;
    }
    Some(commit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    #[test]
    fn old_ui_hide_cannot_hide_the_next_collect_window() {
        use std::sync::Arc;
        let executor = Executor::new();
        let epoch = Arc::new(AtomicU64::new(1));
        let e = executor.clone();
        executor.call(move || e.pause(2)).unwrap();
        let birth = epoch.clone();
        executor
            .defer(move || {
                birth.store(3, Ordering::SeqCst);
            })
            .unwrap();
        let observed = epoch.clone();
        executor
            .defer_guarded(
                move || observed.load(Ordering::SeqCst) == 1,
                || panic!("old blur must not hide the new collect"),
            )
            .unwrap();
        epoch.store(2, Ordering::SeqCst); // old window destruction commits
        executor.resume(2, || {});
        executor.call(|| ()).unwrap();
        assert_eq!(epoch.load(Ordering::SeqCst), 3);
    }
    #[test]
    fn two_collectors_after_destroy_cannot_put_ui_behind_a_worker_lock() {
        let executor = Executor::new();
        let e = executor.clone();
        executor.call(move || e.pause(11)).unwrap();
        let (ui_tx, ui_rx) = mpsc::channel::<(&str, Sender<()>)>();
        let (done_tx, done_rx) = mpsc::channel();
        for name in ["collect A", "collect B"] {
            let tx = ui_tx.clone();
            let done = done_tx.clone();
            executor
                .defer(move || {
                    let (reply, result) = mpsc::channel();
                    tx.send((name, reply)).unwrap();
                    result.recv().unwrap();
                    done.send(name).unwrap();
                })
                .unwrap();
        }
        executor.fence();
        assert!(ui_rx.try_recv().is_err());
        executor.resume(11, || {});
        for expected in ["collect A", "collect B"] {
            let (name, reply) = ui_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            assert_eq!(name, expected);
            // A UI hide/restore can enqueue work while this platform build is waiting.
            executor.defer(|| {}).unwrap();
            reply.send(()).unwrap();
            assert_eq!(
                done_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
                expected
            );
        }
    }
    #[test]
    fn cleanup_authorizes_again_after_new_session_arrives() {
        let state = std::sync::Mutex::new(None::<u64>);
        assert!(state.lock().unwrap().is_none()); // old cleanup was scheduled
        *state.lock().unwrap() = Some(42); // actual new merge before execution
        assert!(commit_if_idle(&state, Option::is_none, || panic!(
            "must not destroy new owner"
        ))
        .is_none());
    }
    #[test]
    fn merge_after_cleanup_observes_its_committed_destroy_gate() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Barrier, Mutex,
        };
        let state = Arc::new(Mutex::new(None::<u64>));
        let published = Arc::new(AtomicBool::new(false));
        let ready = Arc::new(Barrier::new(2));
        let s = state.clone();
        let p = published.clone();
        let r = ready.clone();
        let merge = std::thread::spawn(move || {
            r.wait();
            let mut state = s.lock().unwrap();
            assert!(p.load(Ordering::SeqCst));
            *state = Some(42);
        });
        assert!(commit_if_idle(&state, Option::is_none, || {
            ready.wait();
            published.store(true, Ordering::SeqCst);
        })
        .is_some());
        merge.join().unwrap();
    }
    #[test]
    fn ui_submission_does_not_wait_for_worker_waiting_on_ui() {
        let executor = Executor::new();
        let (ui_tx, ui_rx) = mpsc::channel::<Sender<()>>();
        let (done_tx, done_rx) = mpsc::channel();
        executor
            .defer(move || {
                let (tx, rx) = mpsc::channel();
                ui_tx.send(tx).unwrap();
                rx.recv().unwrap(); // same boundary as platform builder waiting for UI
                done_tx.send("created").unwrap();
            })
            .unwrap();
        let build_reply = ui_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let (destroy_tx, destroy_rx) = mpsc::channel();
        // UI handles close/restore while creation is in flight: submit, never take its lock.
        executor
            .defer(move || destroy_tx.send("destroyed").unwrap())
            .unwrap();
        build_reply.send(()).unwrap();
        assert_eq!(
            done_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            "created"
        );
        assert_eq!(
            destroy_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            "destroyed"
        );
    }
    #[test]
    fn pending_collect_waits_in_queue_not_in_ui_or_executor_loop() {
        let executor = Executor::new();
        let e = executor.clone();
        executor.call(move || e.pause(7)).unwrap();
        let (tx, rx) = mpsc::channel();
        executor.defer(move || tx.send("collect").unwrap()).unwrap();
        executor.fence();
        assert!(rx.try_recv().is_err());
        executor.resume(6, || panic!("old completion must not clear new gate"));
        executor.fence();
        assert!(rx.try_recv().is_err());
        executor.resume(7, || {});
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), "collect");
    }
    #[test]
    fn completion_during_dispatch_is_consumed_after_pause() {
        let executor = Executor::new();
        let e = executor.clone();
        executor
            .call(move || {
                e.resume(2, || {}); // UI can complete before destroy() returns
                e.pause(2);
            })
            .unwrap();
        assert_eq!(executor.call(|| 42).unwrap(), 42);
    }
    #[test]
    fn worker_nested_calls_do_not_wait_for_their_own_queue() {
        let executor = Executor::new();
        let e = executor.clone();
        assert_eq!(executor.call(move || e.call(|| 42).unwrap()).unwrap(), 42);
    }
}
