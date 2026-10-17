use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use ignore::WalkBuilder;
use rmcp::model::{CallToolResult, ContentBlock};
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TreeParams {
    pub path: String,
    #[serde(default = "default_depth")]
    pub depth: u32,
}

fn default_depth() -> u32 {
    2
}

/// A rendered tree is carried in the conversation and re-sent on every later
/// request, so cap it like other tool output: wide listings must not crowd
/// out the working session.
const OUTPUT_LIMIT_BYTES: usize = 50_000;

pub struct TreeTool;

impl TreeTool {
    pub fn new() -> Self {
        Self
    }

    pub fn tree(&self, params: TreeParams) -> CallToolResult {
        let root = PathBuf::from(&params.path);
        self.tree_at(root, params.depth)
    }

    pub fn tree_with_cwd(&self, params: TreeParams, working_dir: Option<&Path>) -> CallToolResult {
        let path = PathBuf::from(&params.path);
        let root = if path.is_absolute() {
            path
        } else {
            working_dir
                .map(Path::to_path_buf)
                .or_else(|| std::env::current_dir().ok())
                .unwrap_or_else(|| PathBuf::from("."))
                .join(path)
        };
        self.tree_at(root, params.depth)
    }

    fn tree_at(&self, root: PathBuf, depth: u32) -> CallToolResult {
        if !root.exists() {
            return CallToolResult::error(vec![ContentBlock::text(format!(
                "Path does not exist: {}",
                root.display()
            ))]);
        }

        if !root.is_dir() {
            return CallToolResult::error(vec![ContentBlock::text(format!(
                "Path is not a directory: {}",
                root.display()
            ))]);
        }

        let max_depth = if depth == 0 {
            None
        } else {
            Some(depth as usize)
        };

        let mut tree = collect_tree(&root, max_depth);
        tree.compute_total_lines();

        let mut output = String::new();
        tree.render_into(0, &mut output);
        if output.is_empty() {
            output.push_str("(empty directory)");
        }

        if output.len() > OUTPUT_LIMIT_BYTES {
            let (truncated, notice) = truncate_rendered_tree(&output);
            return CallToolResult::success(vec![
                ContentBlock::text(truncated),
                ContentBlock::text(notice),
            ]);
        }

        CallToolResult::success(vec![ContentBlock::text(output)])
    }
}

/// Truncates to the last complete line within the byte budget and reports how
/// much was hidden, so the caller can narrow `path` or `depth`.
#[allow(clippy::string_slice)] // Indices are snapped to char and line boundaries.
fn truncate_rendered_tree(rendered: &str) -> (String, String) {
    let total_lines = rendered.lines().count();
    let mut cut = OUTPUT_LIMIT_BYTES.min(rendered.len());
    while !rendered.is_char_boundary(cut) {
        cut -= 1;
    }
    let keep = rendered[..cut]
        .rfind('\n')
        .map_or(cut, |newline| newline + 1);
    let shown_lines = rendered[..keep].lines().count();
    let notice = format!(
        "[Tree truncated: showing the first {shown_lines} of {total_lines} lines. \
         Pass a smaller depth or a narrower path to list the rest.]"
    );
    (rendered[..keep].to_string(), notice)
}

impl Default for TreeTool {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Default)]
struct DirectoryNode {
    dirs: BTreeMap<String, DirectoryNode>,
    files: BTreeMap<String, usize>,
    total_lines: usize,
}

impl DirectoryNode {
    fn insert_dir(&mut self, components: &[String]) {
        let mut node = self;
        for component in components {
            node = node.dirs.entry(component.clone()).or_default();
        }
    }

    fn insert_file(&mut self, components: &[String], line_count: usize) {
        if components.is_empty() {
            return;
        }

        let mut node = self;
        for component in &components[..components.len() - 1] {
            node = node.dirs.entry(component.clone()).or_default();
        }

        let filename = components[components.len() - 1].clone();
        node.files.insert(filename, line_count);
    }

    fn compute_total_lines(&mut self) -> usize {
        let dir_lines: usize = self
            .dirs
            .values_mut()
            .map(DirectoryNode::compute_total_lines)
            .sum();
        let file_lines: usize = self.files.values().copied().sum();
        self.total_lines = dir_lines + file_lines;
        self.total_lines
    }

    fn render_into(&self, depth: usize, out: &mut String) {
        let indent = "  ".repeat(depth);

        for (name, dir) in &self.dirs {
            out.push_str(&format!(
                "{}{}/  {}\n",
                indent,
                name,
                format_lines(dir.total_lines)
            ));
            dir.render_into(depth + 1, out);
        }

        for (name, line_count) in &self.files {
            out.push_str(&format!(
                "{}{}  {}\n",
                indent,
                name,
                format_lines(*line_count)
            ));
        }
    }
}

fn collect_tree(root: &Path, max_depth: Option<usize>) -> DirectoryNode {
    let mut builder = WalkBuilder::new(root);
    builder.git_ignore(true);
    builder.git_exclude(true);
    builder.git_global(true);
    builder.require_git(false);
    builder.ignore(true);
    builder.hidden(true);

    if let Some(depth) = max_depth {
        builder.max_depth(Some(depth + 1));
    }

    let mut tree = DirectoryNode::default();
    for entry in builder.build().flatten() {
        let path = entry.path();
        if path == root {
            continue;
        }

        let rel = match path.strip_prefix(root) {
            Ok(rel) => rel,
            Err(_) => continue,
        };

        let components = match relative_components(rel) {
            Some(components) => components,
            None => continue,
        };

        if entry.file_type().is_some_and(|t| t.is_dir()) {
            tree.insert_dir(&components);
        } else if entry.file_type().is_some_and(|t| t.is_file()) {
            tree.insert_file(&components, count_file_lines(path));
        }
    }

    tree
}

fn relative_components(path: &Path) -> Option<Vec<String>> {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => components.push(value.to_string_lossy().into_owned()),
            _ => return None,
        }
    }

    if components.is_empty() {
        None
    } else {
        Some(components)
    }
}

fn count_file_lines(path: &Path) -> usize {
    match fs::read_to_string(path) {
        Ok(content) => content.lines().count(),
        Err(_) => 0,
    }
}

fn format_lines(lines: usize) -> String {
    if lines >= 1000 {
        format!("[{}K]", lines / 1000)
    } else {
        format!("[{}]", lines)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::ContentBlock;
    use tempfile::TempDir;

    fn extract_text(result: &CallToolResult) -> &str {
        match &result.content[0] {
            ContentBlock::Text(t) => &t.text,
            _ => panic!("expected text"),
        }
    }

    fn setup_tree() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::create_dir_all(dir.path().join("tests")).unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        fs::write(dir.path().join("src/lib.rs"), "pub fn lib() {}\n").unwrap();
        fs::write(dir.path().join("tests/test.rs"), "#[test]\nfn t() {}\n").unwrap();
        dir
    }

    #[test]
    fn tree_lists_files_and_directories() {
        let dir = setup_tree();
        let tool = TreeTool::new();

        let result = tool.tree(TreeParams {
            path: dir.path().display().to_string(),
            depth: 2,
        });

        let text = extract_text(&result);
        assert!(text.contains("src/"));
        assert!(text.contains("tests/"));
        assert!(text.contains("main.rs"));
    }

    #[test]
    fn tree_respects_depth() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("a/b/c")).unwrap();
        fs::write(dir.path().join("a/b/c/deep.rs"), "fn deep() {}\n").unwrap();

        let tool = TreeTool::new();
        let result = tool.tree(TreeParams {
            path: dir.path().display().to_string(),
            depth: 1,
        });

        let text = extract_text(&result);
        assert!(text.contains("a/"));
        assert!(text.contains("b/"));
        assert!(!text.contains("deep.rs"));
    }

    #[test]
    fn tree_uses_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".gitignore"), "ignored/\n*.log\n").unwrap();
        fs::create_dir_all(dir.path().join("ignored")).unwrap();
        fs::write(dir.path().join("ignored/secret.rs"), "fn secret() {}\n").unwrap();
        fs::write(dir.path().join("visible.rs"), "fn visible() {}\n").unwrap();
        fs::write(dir.path().join("debug.log"), "hidden\n").unwrap();

        let tool = TreeTool::new();
        let result = tool.tree(TreeParams {
            path: dir.path().display().to_string(),
            depth: 2,
        });

        let text = extract_text(&result);
        assert!(text.contains("visible.rs"));
        assert!(!text.contains("ignored"));
        assert!(!text.contains("debug.log"));
    }

    #[test]
    fn tree_caps_large_output_with_notice() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..2_000 {
            fs::write(
                dir.path()
                    .join(format!("file_{i:04}_with_a_reasonably_long_name.rs")),
                "fn f() {}\n",
            )
            .unwrap();
        }

        let tool = TreeTool::new();
        let result = tool.tree(TreeParams {
            path: dir.path().display().to_string(),
            depth: 1,
        });

        assert_eq!(result.content.len(), 2);
        let text = extract_text(&result);
        assert!(!text.is_empty());
        assert!(text.len() <= OUTPUT_LIMIT_BYTES);

        let notice = match &result.content[1] {
            ContentBlock::Text(t) => &t.text,
            _ => panic!("expected text"),
        };
        assert!(notice.contains("Tree truncated"));
        assert!(notice.contains("of 2000 lines"));
    }

    #[test]
    fn truncate_rendered_tree_snaps_to_char_boundary() {
        let mut rendered = "x".repeat(OUTPUT_LIMIT_BYTES - 1);
        rendered.push('é');
        rendered.push_str(&"x".repeat(100));

        let (truncated, notice) = truncate_rendered_tree(&rendered);

        assert!(truncated.len() < OUTPUT_LIMIT_BYTES);
        assert!(truncated.chars().all(|c| c == 'x'));
        assert!(notice.contains("showing the first"));
    }
}
