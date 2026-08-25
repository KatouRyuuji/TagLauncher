//! 目录复制共用工具：mod 导入/导出与主题包安装统一复用，
//! 保证「不跟随链接/重解析点」与「源/目标嵌套」两处防御口径单一来源。

use std::path::{Path, PathBuf};

/// Windows 重解析点（junction / symlink）属性位（FILE_ATTRIBUTE_REPARSE_POINT）。
#[cfg(windows)]
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

/// 判断目录项是否为链接/重解析点（复制时不跟随、遇到即跳过）。
/// Windows 上 junction 的 file_type().is_symlink() 为 false，必须用
/// REPARSE_POINT 属性位判定（与 item_service 扫描同一写法）；非 Windows 平台回退 is_symlink。
fn is_reparse_point(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

/// 递归复制目录。不跟随符号链接/重解析点（遇到即跳过）：包内链接会把包外
/// 任意文件拖入目标目录（主题包随后可能被前端经 convertFileSrc 读取）。
pub fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let meta = std::fs::symlink_metadata(&src_path).map_err(|e| e.to_string())?;
        if is_reparse_point(&meta) {
            continue;
        }
        if meta.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 源/目标嵌套关系（目录复制前的自我递归防御）。
pub enum DirNesting {
    /// 源即目标
    Same,
    /// 源是目标的祖先：继续复制会把源递归搬进其子目录（copy_dir_all 自我递归）
    SourceContainsTarget,
    /// 源在目标内：替换式删除/复制会连源一起处理掉
    TargetContainsSource,
    /// 无嵌套，可安全复制
    Disjoint,
}

/// canonical 后判定源/目标嵌套关系。目标可能尚不存在（canonicalize 会失败），
/// 退化为 canonicalize 最近存在的祖先后拼回缺失组件（宽松规范化）。
pub fn detect_dir_nesting(source: &Path, target: &Path) -> Result<DirNesting, String> {
    let canonical_source = canonicalize_lenient(source)?;
    let canonical_target = canonicalize_lenient(target)?;
    if canonical_source == canonical_target {
        Ok(DirNesting::Same)
    } else if canonical_target.starts_with(&canonical_source) {
        Ok(DirNesting::SourceContainsTarget)
    } else if canonical_source.starts_with(&canonical_target) {
        Ok(DirNesting::TargetContainsSource)
    } else {
        Ok(DirNesting::Disjoint)
    }
}

/// 宽松 canonicalize：路径不存在时向上找最近存在的祖先，canonicalize 后拼回缺失部分；
/// 一路到根仍不存在（异常形态）时按原样返回，后续比较退化为词法比较。
fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    let mut missing: Vec<&std::ffi::OsStr> = Vec::new();
    let mut cursor = path;
    loop {
        if cursor.exists() {
            let mut base = cursor
                .canonicalize()
                .map_err(|e| format!("无法解析路径 {:?}: {}", path, e))?;
            for name in missing.iter().rev() {
                base.push(name);
            }
            return Ok(base);
        }
        match (cursor.parent(), cursor.file_name()) {
            (Some(parent), Some(name)) => {
                missing.push(name);
                cursor = parent;
            }
            _ => return Ok(path.to_path_buf()),
        }
    }
}
