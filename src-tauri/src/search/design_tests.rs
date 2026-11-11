//! 搜索设计回归：由迁移前的 src/lib/search.design.test.ts 逐条移植（期望值不变）。

use std::sync::Arc;

use super::engine::{self, Entry, EntrySource, Mode, Synonyms};

#[derive(Clone)]
struct It {
    id: i64,
    name: &'static str,
    path: Option<&'static str>,
    tags: Vec<&'static str>,
    fav: bool,
    note: Option<&'static str>,
    alias: Option<&'static str>,
}

fn item(id: i64, name: &'static str, tags: &[&'static str]) -> It {
    It {
        id,
        name,
        path: None,
        tags: tags.to_vec(),
        fav: false,
        note: None,
        alias: None,
    }
}

fn entries(items: &[It]) -> Vec<Entry> {
    items
        .iter()
        .map(|it| {
            let path = it
                .path
                .map(String::from)
                .unwrap_or_else(|| format!("D:\\{}", it.name));
            let src = EntrySource {
                id: it.id,
                name: it.name,
                path: &path,
                alias: it.alias,
                note: it.note,
                is_favorite: it.fav,
                is_missing: false,
                item_type: "exe",
            };
            let tags = it
                .tags
                .iter()
                .map(|t| Arc::new(engine::build_text(t)))
                .collect();
            Entry::build(&src, tags, &mut |s| Arc::new(engine::build_text(s)))
        })
        .collect()
}

fn groups(gs: &[&[&str]]) -> Synonyms {
    Synonyms::from_groups(
        &gs.iter()
            .map(|g| g.iter().map(|s| s.to_string()).collect())
            .collect::<Vec<_>>(),
    )
}

fn search(es: &[Entry], mode: Mode, syn: &Synonyms, q: &str) -> Vec<i64> {
    engine::run(&engine::compile(q, mode, syn), es)
        .into_iter()
        .map(|e| e.id)
        .collect()
}

fn base() -> (Vec<Entry>, Vec<Entry>, Synonyms) {
    let items = vec![
        item(1, "tag", &["2d游戏"]),
        item(2, "忍者神龟", &["动作"]),
        item(3, "abc", &["2d游戏", "工具"]),
    ];
    (
        entries(&items),
        entries(&items),
        groups(&[&["忍者神龟", "四小王八"], &["2d游戏", "平面游戏"]]),
    )
}

#[test]
fn basic_synonyms_tags_expressions() {
    let (all, tag, syn) = base();
    let a = |q: &str| search(&all, Mode::All, &syn, q);
    let t = |q: &str| search(&tag, Mode::Tag, &syn, q);
    assert_eq!(a(""), vec![1, 2, 3]);
    assert_eq!(a("ta"), vec![1]);
    assert_eq!(a("ag"), Vec::<i64>::new());
    assert_eq!(a("renzheshengui"), vec![2]);
    assert_eq!(a("zhe"), Vec::<i64>::new());
    assert_eq!(a("四小王八"), vec![2]);
    assert_eq!(t("2dyouxi"), vec![1, 3]);
    assert_eq!(t("平面游戏"), vec![1, 3]);
    assert_eq!(a("tag||忍者"), vec![1, 2]);
    assert_eq!(a("tag 忍者"), vec![1, 2]);
    assert_eq!(a("tag&&2d"), vec![1]);
    assert_eq!(a("!!tag"), vec![2, 3]);
    assert_eq!(a("(tag||忍者)!!忍者"), vec![1]);
    assert_eq!(a("tag || 忍者"), vec![1, 2]);
    assert_eq!(a("tag || 2d游戏"), vec![1, 3]);
    assert_eq!(a("tag||!!tag"), vec![1, 2, 3]);
    assert_eq!(a("tag || !!tag"), vec![1, 2, 3]);
    assert_eq!(a("tag !!2d游戏"), Vec::<i64>::new());
    assert_eq!(a("@忍者神龟"), vec![2]);
    assert_eq!(a("@忍者"), Vec::<i64>::new());
    // B5 优先级
    assert_eq!(a("忍者&&动作||2d游戏"), vec![1, 2, 3]);
    assert_eq!(a("(忍者||2d游戏)&&动作"), vec![2]);
    assert_eq!(a("((tag))"), a("tag"));
    // B6 / B7 / B9 / B11
    assert_eq!(a("@2d游戏"), vec![1, 3]);
    assert_eq!(a("@tag"), vec![1]);
    assert_eq!(a("rzsg"), vec![2]);
    assert_eq!(a("rz"), vec![2]);
    assert_eq!(a("@四小王八"), Vec::<i64>::new());
    assert_eq!(a("@"), Vec::<i64>::new());
}

#[test]
fn exclude_order_independent() {
    let es = entries(&[
        item(11, "alpha", &[]),
        item(12, "beta", &[]),
        item(13, "gamma", &[]),
    ]);
    let syn = Synonyms::default();
    assert_eq!(
        search(&es, Mode::All, &syn, "(alpha||beta||gamma)!!beta!!gamma"),
        vec![11]
    );
    assert_eq!(
        search(&es, Mode::All, &syn, "(alpha||beta||gamma)!!gamma!!beta"),
        vec![11]
    );
}

#[test]
fn typo_tolerance() {
    let syn = Synonyms::default();
    let es = entries(&[item(21, "test", &[]), item(22, "node", &[])]);
    let n = |q: &str| search(&es, Mode::Name, &syn, q);
    for q in ["tesst", "teest", "test", "trst"] {
        assert_eq!(n(q), vec![21], "{q}");
    }
    assert_eq!(n("bode"), Vec::<i64>::new());
    assert_eq!(
        search(&entries(&[item(23, "abc", &[])]), Mode::Name, &syn, "bc"),
        Vec::<i64>::new()
    );
    // BUG-09
    let es = entries(&[item(24, "blender.txt", &[]), item(25, "zzz.txt", &[])]);
    for q in ["blennder", "blnder", "blendr"] {
        assert_eq!(search(&es, Mode::Name, &syn, q), vec![24], "{q}");
    }
    assert_eq!(search(&es, Mode::Name, &syn, "blxxder"), Vec::<i64>::new());
    // B8
    let es = entries(&[item(51, "hello", &[]), item(52, "world", &[])]);
    assert_eq!(search(&es, Mode::Name, &syn, "jello"), vec![51]);
    assert_eq!(search(&es, Mode::Name, &syn, "jelly"), Vec::<i64>::new());
    // B15
    let es = entries(&[
        item(91, "Visual Studio Code", &[]),
        item(92, "Google Chrome", &[]),
        item(93, "Chrome浏览器", &[]),
        item(94, "chrome.exe", &[]),
        item(95, "My Node App", &[]),
    ]);
    let n = |q: &str| search(&es, Mode::Name, &syn, q);
    assert_eq!(n("visul"), vec![91]);
    assert_eq!(n("chromr"), vec![92, 93, 94]);
    assert_eq!(n("bode"), Vec::<i64>::new());
    assert_eq!(n("vizul"), Vec::<i64>::new());
    assert_eq!(n("@visul"), Vec::<i64>::new());
}

#[test]
fn cjk_substring_and_pinyin_prefix() {
    let syn = Synonyms::default();
    let es = entries(&[
        item(51, "周杰伦 - 晴天", &[]),
        item(52, "青海湖日落", &[]),
        item(53, "忍者神龟", &[]),
    ]);
    let n = |q: &str| search(&es, Mode::Name, &syn, q);
    assert_eq!(n("晴天"), vec![51]);
    assert_eq!(n("神龟"), vec![53]);
    assert_eq!(n("伦晴"), Vec::<i64>::new());
    assert_eq!(n("zjl"), vec![51]);
    assert_eq!(n("qt"), Vec::<i64>::new());
}

#[test]
fn path_drive_stripped_and_favorites_first() {
    let syn = Synonyms::default();
    let mut z = item(31, "zebra", &[]);
    z.path = Some("D:\\zebra");
    let es = entries(&[z]);
    assert_eq!(search(&es, Mode::Name, &syn, "d"), Vec::<i64>::new());
    assert_eq!(search(&es, Mode::Name, &syn, "d:"), Vec::<i64>::new());
    let favs: Vec<It> = [(41, false), (42, true), (43, false), (44, true)]
        .into_iter()
        .map(|(id, fav)| It {
            fav,
            ..item(id, "stx", &[])
        })
        .collect();
    assert_eq!(
        search(&entries(&favs), Mode::Name, &syn, "stx"),
        vec![42, 44, 41, 43]
    );
}

#[test]
fn english_abbreviations_and_ranking() {
    let syn = Synonyms::default();
    let es = entries(&[
        item(61, "Visual Studio Code", &[]),
        item(62, "Visual Studio Code 2022", &[]),
        item(63, "abc", &[]),
    ]);
    let n = |q: &str| search(&es, Mode::Name, &syn, q);
    assert_eq!(n("vsc"), vec![61, 62]);
    assert_eq!(n("vscode"), vec![61, 62]);
    assert_eq!(n("bc"), Vec::<i64>::new());
    assert_eq!(n("s"), Vec::<i64>::new());
    let es = entries(&[
        item(71, "my-file_name", &[]),
        item(72, "QuickTimePlayer", &[]),
    ]);
    assert_eq!(search(&es, Mode::Name, &syn, "mfn"), vec![71]);
    assert_eq!(search(&es, Mode::Name, &syn, "qtp"), vec![72]);
    assert_eq!(
        search(
            &entries(&[item(73, "x", &["Dev Tools"])]),
            Mode::Tag,
            &syn,
            "dt"
        ),
        vec![73]
    );
    // B14
    assert_eq!(
        search(
            &entries(&[
                item(81, "Visual Studio Code", &[]),
                item(82, "codepen", &[])
            ]),
            Mode::Name,
            &syn,
            "code"
        ),
        vec![82, 81]
    );
    let fav = It {
        fav: true,
        ..item(83, "Visual Studio Code", &[])
    };
    assert_eq!(
        search(
            &entries(&[fav, item(84, "codepen", &[])]),
            Mode::Name,
            &syn,
            "code"
        ),
        vec![83, 84]
    );
}

#[test]
fn shared_tag_text_and_normalization() {
    let syn = Synonyms::default();
    let before = entries(&[item(90001, "一", &["资料"]), item(90002, "二", &["资料"])]);
    let renamed = entries(&[item(90001, "一", &["阅读"]), item(90002, "二", &["资料"])]);
    assert_eq!(search(&before, Mode::Tag, &syn, "zl"), vec![90001, 90002]);
    assert_eq!(search(&renamed, Mode::Tag, &syn, "yd"), vec![90001]);
    assert_eq!(search(&renamed, Mode::Tag, &syn, "zl"), vec![90002]);
    let es = entries(&[
        item(91001, "  VISUAL Studio Code  ", &[]),
        item(91002, "资料", &[" 阅读 "]),
    ]);
    assert_eq!(
        search(&es, Mode::All, &syn, "@VISUAL Studio Code"),
        vec![91001]
    );
    assert_eq!(search(&es, Mode::All, &syn, " VSC "), vec![91001]);
    assert_eq!(
        search(&es, Mode::All, &groups(&[&["读物", "阅读"]]), "读物"),
        vec![91002]
    );
    assert_eq!(
        search(
            &es,
            Mode::All,
            &groups(&[&["读物", "VISUAL Studio Code"]]),
            "读物"
        ),
        vec![91001]
    );
}

#[test]
fn notes_and_aliases() {
    let syn = Synonyms::default();
    let noted = It {
        note: Some("公司 VPN 账号在密码本第三页"),
        ..item(92001, "启动器", &[])
    };
    let named = item(92002, "VPN 客户端", &[]);
    let all = entries(&[noted.clone(), named.clone()]);
    assert_eq!(search(&all, Mode::All, &syn, "密码本"), vec![92001]);
    assert_eq!(search(&all, Mode::All, &syn, "vpn"), vec![92002, 92001]);
    assert_eq!(search(&all, Mode::All, &syn, "@密码本"), Vec::<i64>::new());
    assert_eq!(search(&all, Mode::Tag, &syn, "密码本"), Vec::<i64>::new());

    let aliased = It {
        alias: Some("安装器"),
        ..item(94001, "setup_x64.exe", &[])
    };
    let es = entries(&[aliased, item(94002, "readme.txt", &[])]);
    for q in ["安装", "azq", "@安装器", "setup"] {
        assert_eq!(search(&es, Mode::Name, &syn, q), vec![94001], "{q}");
    }
    assert_eq!(search(&es, Mode::All, &syn, "安装器"), vec![94001]);
    assert_eq!(search(&es, Mode::Tag, &syn, "安装器"), Vec::<i64>::new());
    let blank = It {
        alias: Some("   "),
        ..item(95001, "a.exe", &[])
    };
    assert_eq!(
        search(&entries(&[blank]), Mode::Name, &syn, "a"),
        vec![95001],
        "空白别名视为未设"
    );
}
