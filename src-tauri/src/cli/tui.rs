//! tl tui —— 终端交互界面。
//!
//! 单屏布局：顶部搜索框 + 结果列表 + 底部按键提示。输入即过滤（数据库全文搜索），
//! ↑/↓ 选择，Enter 启动，Ctrl+D 收藏切换，Esc/Ctrl+C 退出。
//! 与 GUI/CLI 共享同一服务层与数据库（WAL 并发安全）。

use crate::db::Database;
use crate::models::ItemWithTags;
use crate::services::{launch_service, search_service};
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph};
use ratatui::Terminal;
use std::io::Stdout;
use std::time::Duration;

struct TuiApp {
    db: Database,
    query: String,
    items: Vec<ItemWithTags>,
    selected: usize,
    /// 底部状态行消息（启动结果 / 错误）
    status: String,
}

impl TuiApp {
    fn new(db: Database) -> Self {
        let mut app = Self {
            db,
            query: String::new(),
            items: Vec::new(),
            selected: 0,
            status: "输入以搜索；Enter 启动，Ctrl+D 收藏，Esc 退出".to_string(),
        };
        app.refresh();
        app
    }

    fn refresh(&mut self) {
        let conn = self.db.get_conn();
        match search_service::search_items(&conn, &self.query, &[]) {
            Ok(mut items) => {
                items.truncate(200);
                self.items = items;
                self.status.clear();
            }
            Err(e) => {
                self.items.clear();
                self.status = format!("搜索失败: {e}");
            }
        }
        if self.selected >= self.items.len() {
            self.selected = self.items.len().saturating_sub(1);
        }
    }

    fn launch_selected(&mut self) {
        let Some(item) = self.items.get(self.selected) else { return };
        let id = item.item.id;
        let name = item.item.name.clone();
        let conn = self.db.get_conn();
        self.status = match launch_service::launch_item(&conn, id) {
            Ok(()) => format!("已启动 #{id} {name}"),
            Err(e) => format!("启动失败: {e}"),
        };
    }

    fn toggle_favorite(&mut self) {
        let Some(item) = self.items.get(self.selected) else { return };
        let id = item.item.id;
        let conn = self.db.get_conn();
        match crate::services::item_service::toggle_favorite(&conn, id) {
            Ok(fav) => {
                self.status = format!("#{} {} {}", id, item.item.name, if fav { "已收藏" } else { "已取消收藏" });
                drop(conn);
                self.refresh();
            }
            Err(e) => self.status = format!("收藏操作失败: {e}"),
        }
    }
}

pub fn run() -> Result<(), String> {
    let db = super::open_db()?;

    enable_raw_mode().map_err(|e| format!("进入 raw mode 失败: {e}"))?;
    let mut stdout = std::io::stdout();
    execute!(stdout, EnterAlternateScreen).map_err(|e| format!("切换备用屏幕失败: {e}"))?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).map_err(|e| format!("初始化终端失败: {e}"))?;

    let result = event_loop(&mut terminal, TuiApp::new(db));

    // 无论如何先恢复终端状态，再向上传播运行期错误
    let _ = disable_raw_mode();
    let _ = execute!(terminal.backend_mut(), LeaveAlternateScreen);
    result
}

fn event_loop(terminal: &mut Terminal<CrosstermBackend<Stdout>>, mut app: TuiApp) -> Result<(), String> {
    loop {
        terminal.draw(|frame| draw(frame, &app)).map_err(|e| format!("绘制失败: {e}"))?;

        if !event::poll(Duration::from_millis(250)).map_err(|e| e.to_string())? {
            continue;
        }
        let Event::Key(key) = event::read().map_err(|e| e.to_string())? else { continue };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Esc => return Ok(()),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => return Ok(()),
            // Ctrl+D 收藏切换（对齐 GUI 快捷键）；字母键一律进搜索框，不与输入冲突
            KeyCode::Char('d') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                app.toggle_favorite();
            }
            KeyCode::Enter => app.launch_selected(),
            KeyCode::Up => {
                app.selected = app.selected.saturating_sub(1);
            }
            KeyCode::Down => {
                if app.selected + 1 < app.items.len() {
                    app.selected += 1;
                }
            }
            KeyCode::PageUp => {
                app.selected = app.selected.saturating_sub(10);
            }
            KeyCode::PageDown => {
                app.selected = (app.selected + 10).min(app.items.len().saturating_sub(1));
            }
            KeyCode::Backspace => {
                app.query.pop();
                app.selected = 0;
                app.refresh();
            }
            KeyCode::Char(c) if key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT => {
                app.query.push(c);
                app.selected = 0;
                app.refresh();
            }
            _ => {}
        }
    }
}

fn draw(frame: &mut ratatui::Frame, app: &TuiApp) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(3),
            Constraint::Length(1),
        ])
        .split(frame.area());

    let input = Paragraph::new(app.query.as_str())
        .block(Block::default().title("搜索（输入即过滤）").borders(Borders::ALL));
    frame.render_widget(input, chunks[0]);
    // 光标放在搜索框文本末尾（按终端列宽，CJK 计 2 列）
    let cursor_x = chunks[0].x.saturating_add(display_cols(&app.query)).saturating_add(1);
    frame.set_cursor_position((cursor_x.min(chunks[0].right().saturating_sub(1)), chunks[0].y + 1));

    let items: Vec<ListItem> = app
        .items
        .iter()
        .map(|it| {
            let fav = if it.item.is_favorite { "★" } else { " " };
            let tags = it.tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>().join(",");
            ListItem::new(Line::from(vec![
                Span::raw(format!("{} #{:<5} {:<7} ", fav, it.item.id, it.item.item_type)),
                Span::styled(&it.item.name, Style::default().add_modifier(Modifier::BOLD)),
                Span::styled(format!("  {tags}"), Style::default().fg(Color::DarkGray)),
            ]))
        })
        .collect();
    let list = List::new(items)
        .block(Block::default().title(format!("结果（{}）", app.items.len())).borders(Borders::ALL))
        .highlight_style(Style::default().fg(Color::Cyan).add_modifier(Modifier::REVERSED));
    let mut state = ListState::default();
    if !app.items.is_empty() {
        state.select(Some(app.selected));
    }
    frame.render_stateful_widget(list, chunks[1], &mut state);

    let footer = if app.status.is_empty() {
        "Enter 启动 · Ctrl+D 收藏/取消 · ↑↓ PgUp PgDn 选择 · Esc 退出"
    } else {
        app.status.as_str()
    };
    frame.render_widget(Paragraph::new(footer), chunks[2]);
}

/// 终端显示列宽：ASCII 1 列，宽字符（CJK 等）2 列。
fn display_cols(s: &str) -> u16 {
    s.chars()
        .map(|c| if is_wide(c) { 2u16 } else { 1 })
        .fold(0u16, |acc, w| acc.saturating_add(w))
}

fn is_wide(c: char) -> bool {
    matches!(
        c as u32,
        0x1100..=0x115F
            | 0x2329..=0x232A
            | 0x2E80..=0xA4CF
            | 0xAC00..=0xD7A3
            | 0xF900..=0xFAFF
            | 0xFE10..=0xFE19
            | 0xFE30..=0xFE6F
            | 0xFF00..=0xFF60
            | 0xFFE0..=0xFFE6
            | 0x1F300..=0x1F64F
            | 0x1F900..=0x1F9FF
            | 0x20000..=0x3FFFD
    )
}

#[cfg(test)]
mod tests {
    use super::display_cols;

    #[test]
    fn display_cols_ascii_and_cjk() {
        assert_eq!(display_cols("ab"), 2);
        assert_eq!(display_cols("中"), 2);
        assert_eq!(display_cols("a中b"), 4);
        assert_eq!(display_cols(""), 0);
    }
}
