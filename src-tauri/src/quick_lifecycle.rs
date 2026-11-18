//! 快速窗生命周期决策：纯逻辑，不依赖 Tauri / GTK。
//!
//! 固定标签 `quick` 下，Tauri 的 destroy 只是把 Destroy 消息入队，manager 在 UI
//! 处理前仍可能拿得到旧窗。两轮「ensure 同步 Condvar 等 Destroyed」都没把门闭上：
//! 完成信号会漏，UI 也会等自己的事件。本模块只描述认领/退让/自愈规则；
//! 产品侧由 quick_executor 单一后台执行者顺序运行平台工作；UI 只提交任务/完成通知，永不等待。

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DestroyState {
    #[default]
    Idle,
    /// destroy() 已成功把 Destroy 入队，manager 可能仍拿得到旧窗。
    Queued,
    /// destroy 消息没发出去。CloseRequested 对 quick 一律 prevent_close，
    /// 因此 close 回退也不构成完成协议。此态不可认领、不可等待、不可清成可认领。
    DispatchFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnsureAction {
    ClaimExisting,
    /// manager 已没有窗口：过期 queued / 漏掉的监听视为已完成，可以建新窗。
    CreateFresh,
    /// 旧窗还在且 Destroy 已入队。UI 必须退让；后台可把创建 post 到本轮 Destroy 之后。
    YieldPendingDestroy,
    RejectDispatchFailed,
}

pub fn ensure_action(present: bool, state: DestroyState) -> EnsureAction {
    match (present, state) {
        (true, DestroyState::Idle) => EnsureAction::ClaimExisting,
        (true, DestroyState::Queued) => EnsureAction::YieldPendingDestroy,
        (true, DestroyState::DispatchFailed) => EnsureAction::RejectDispatchFailed,
        (false, _) => EnsureAction::CreateFresh,
    }
}

pub fn existing_quick_is_claimable(present: bool, state: DestroyState) -> bool {
    ensure_action(present, state) == EnsureAction::ClaimExisting
}

/// 调用方在 UI 线程时，不得为了 Destroy / 后续任务而同步阻塞。
pub fn may_block_for_ui_progress(caller_is_ui_thread: bool) -> bool {
    !caller_is_ui_thread
}

/// 失焦 hide、CloseRequested hide、同步 quick_hide 最终会走进 pin::restore → ensure。
/// 销毁已排队或派发失败时，这些 UI 入口不得进入 ensure。
pub fn ui_hide_may_enter_ensure(state: DestroyState) -> bool {
    state == DestroyState::Idle
}

pub fn next_state_after_destroy_dispatch(destroy_sent: bool) -> DestroyState {
    if destroy_sent {
        DestroyState::Queued
    } else {
        DestroyState::DispatchFailed
    }
}

/// 全局 Builder 级 Destroyed（窗口对外暴露前已安装）。只把 Queued 收成 Idle。
pub fn next_state_after_destroyed_event(state: DestroyState) -> DestroyState {
    match state {
        DestroyState::Queued => DestroyState::Idle,
        other => other,
    }
}

/// 准备按 ensure_action 建新窗时：manager 已空，过期标记自愈为 Idle。
pub fn next_state_after_ensure(present: bool, state: DestroyState) -> DestroyState {
    if !present {
        DestroyState::Idle
    } else {
        state
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;

    #[test]
    fn claim_create_yield_reject_matrix() {
        use DestroyState::*;
        use EnsureAction::*;
        let cases = [
            (true, Idle, ClaimExisting, true),
            (true, Queued, YieldPendingDestroy, false),
            (true, DispatchFailed, RejectDispatchFailed, false),
            (false, Idle, CreateFresh, false),
            (false, Queued, CreateFresh, false),
            (false, DispatchFailed, CreateFresh, false),
        ];
        for (present, state, action, claimable) in cases {
            assert_eq!(
                ensure_action(present, state),
                action,
                "{present:?} {state:?}"
            );
            assert_eq!(
                existing_quick_is_claimable(present, state),
                claimable,
                "{present:?} {state:?}"
            );
        }
    }

    #[test]
    fn missed_per_window_listener_self_heals_when_manager_empty() {
        // 窗口已对 manager 发布、局部 listener 尚未安装时取消；UI 已处理 Destroy，
        // 全局通知若也漏了，只要 manager 拿不到窗，ensure 必须能建新窗而不是永久等待。
        assert_eq!(
            ensure_action(false, DestroyState::Queued),
            EnsureAction::CreateFresh
        );
        assert_eq!(
            next_state_after_ensure(false, DestroyState::Queued),
            DestroyState::Idle
        );
    }

    #[test]
    fn ui_thread_never_blocks_for_its_own_events() {
        assert!(!may_block_for_ui_progress(true));
        assert!(may_block_for_ui_progress(false));
    }

    #[test]
    fn ui_hide_restore_entries_yield_during_destroy() {
        assert!(ui_hide_may_enter_ensure(DestroyState::Idle));
        assert!(!ui_hide_may_enter_ensure(DestroyState::Queued));
        assert!(!ui_hide_may_enter_ensure(DestroyState::DispatchFailed));
    }

    #[test]
    fn dispatch_failure_is_terminal_unclaimable_and_not_a_wait() {
        assert_eq!(
            next_state_after_destroy_dispatch(false),
            DestroyState::DispatchFailed
        );
        assert_eq!(
            next_state_after_destroy_dispatch(true),
            DestroyState::Queued
        );
        assert_eq!(
            ensure_action(true, DestroyState::DispatchFailed),
            EnsureAction::RejectDispatchFailed
        );
        // 失败后的 Destroyed 也不把 Failed 洗成可认领
        assert_eq!(
            next_state_after_destroyed_event(DestroyState::DispatchFailed),
            DestroyState::DispatchFailed
        );
        // manager 已空才允许建新窗（窗口确实没了）
        assert_eq!(
            ensure_action(false, DestroyState::DispatchFailed),
            EnsureAction::CreateFresh
        );
    }

    #[test]
    fn global_destroyed_clears_only_queued() {
        assert_eq!(
            next_state_after_destroyed_event(DestroyState::Queued),
            DestroyState::Idle
        );
        assert_eq!(
            next_state_after_destroyed_event(DestroyState::Idle),
            DestroyState::Idle
        );
        assert_eq!(
            next_state_after_destroyed_event(DestroyState::DispatchFailed),
            DestroyState::DispatchFailed
        );
    }

    #[test]
    fn ui_event_order_destroy_then_posted_ensure_creates() {
        // 后台在 Destroy 入队之后把 ensure post 到 UI：同一队列里 Destroy 在前。
        let mut q = VecDeque::from(["destroy", "ensure"]);
        let mut present = true;
        let mut state = DestroyState::Queued;
        let mut action = None;
        while let Some(ev) = q.pop_front() {
            match ev {
                "destroy" => {
                    present = false;
                    state = next_state_after_destroyed_event(state);
                }
                "ensure" => {
                    action = Some(ensure_action(present, state));
                    state = next_state_after_ensure(present, state);
                }
                _ => {}
            }
        }
        assert_eq!(action, Some(EnsureAction::CreateFresh));
        assert_eq!(state, DestroyState::Idle);
    }

    #[test]
    fn ui_ensure_on_same_queue_yields_instead_of_waiting() {
        // Destroy 还在后面时，UI 上的 ensure 只能退让，不能等这条后续消息。
        assert_eq!(
            ensure_action(true, DestroyState::Queued),
            EnsureAction::YieldPendingDestroy
        );
        assert!(!may_block_for_ui_progress(true));
    }

    #[test]
    fn worker_asserts_unclaimable_before_completion_not_raced_with_clear() {
        // 两阶段屏障：worker 先完成 queued / 不可认领断言，再让「完成」发生。
        // 完成走产品规则（官方 Destroyed + manager 已空），不是先 clear 再断言。
        let state = Arc::new(Mutex::new(DestroyState::Queued));
        let asserted = Arc::new(Barrier::new(2));
        let completed = Arc::new(Barrier::new(2));
        let state_w = state.clone();
        let a1 = asserted.clone();
        let c1 = completed.clone();
        let job = thread::spawn(move || {
            let s = *state_w.lock().expect("state");
            assert_eq!(ensure_action(true, s), EnsureAction::YieldPendingDestroy);
            assert!(!existing_quick_is_claimable(true, s));
            a1.wait();
            c1.wait();
            let s = *state_w.lock().expect("state");
            assert_eq!(ensure_action(false, s), EnsureAction::CreateFresh);
        });
        asserted.wait();
        {
            let mut g = state.lock().expect("state");
            *g = next_state_after_destroyed_event(*g);
        }
        completed.wait();
        job.join().expect("worker");
    }

    #[test]
    fn cancel_during_create_gap_then_collect_can_proceed() {
        // 创建已发布、完成信号还没装上就取消：先不可认领；销毁完成后允许真实 collect 创建。
        let mut present = true;
        let mut state = next_state_after_destroy_dispatch(true);
        assert_eq!(
            ensure_action(present, state),
            EnsureAction::YieldPendingDestroy
        );
        present = false;
        state = next_state_after_ensure(present, state);
        assert_eq!(ensure_action(present, state), EnsureAction::CreateFresh);
        // 新窗可被 collect 认领
        present = true;
        assert_eq!(ensure_action(present, state), EnsureAction::ClaimExisting);
    }
}
