//! Packaging one skill to hand to a friend, and importing one a friend handed back — the
//! 技能分享给好友 piece of the design doc's collaboration-group plan. The actual transfer (sending
//! the package's bytes to a friend's computer) rides the same not-yet-wired P2P data channel as
//! `social::tasks`; this module only does the local packaging/unpacking and the
//! accept/overwrite/keep-both conflict resolution once a package arrives.

use super::{Skill, save, skills, skills_dir, unique_id};
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// A skill, packaged up to send: its metadata plus every file in its directory, read into
/// memory. Skills are small (a SKILL.md and a few reference files), so this is never more than
/// a few hundred KB — nothing here streams.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPackage {
    pub name: String,
    pub description: String,
    /// Relative path within the skill's own directory → file bytes.
    pub files: Vec<(String, Vec<u8>)>,
}

/// How to resolve a name collision with a skill already in the recipient's library. Ignored
/// (there's nothing to resolve) when no existing skill shares the incoming one's name.
pub enum Conflict {
    /// Replaces the existing skill's files in place; keeps its id.
    Overwrite,
    /// Installs the incoming skill alongside the existing one, under a fresh id.
    KeepBoth,
}

/// Packages a skill for sending. Walks its directory recursively; a file that can't be read is
/// skipped rather than failing the whole export, since a skill's own cache or scratch files
/// shouldn't block sharing it.
pub fn export(store: &crate::store::Store, skill_id: &str) -> Result<SkillPackage> {
    let skill = skills(store).into_iter().find(|s| s.id == skill_id).ok_or_else(|| anyhow::anyhow!("没有这个 skill"))?;
    let root = skill.dir();
    let mut files = Vec::new();
    collect_files(&root, &root, &mut files);
    Ok(SkillPackage { name: skill.name, description: skill.description, files })
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, out);
        } else if let (Ok(rel), Ok(bytes)) = (path.strip_prefix(root), fs::read(&path)) {
            if let Some(rel) = rel.to_str() {
                out.push((rel.to_string(), bytes));
            }
        }
    }
}

/// Imports a received package, resolving a name collision per `on_conflict` (ignored when
/// there's no collision). Registers the result exactly like a downloaded or hand-written
/// skill, so it shows up everywhere an installed skill does.
pub fn import(store: &crate::store::Store, package: &SkillPackage, on_conflict: Conflict) -> Result<Skill> {
    if package.files.is_empty() {
        bail!("这个 skill 是空的");
    }
    let mut all = skills(store);
    let existing = all.iter().position(|s| s.name == package.name);

    let (id, replacing) = match (existing, on_conflict) {
        (Some(pos), Conflict::Overwrite) => (all[pos].id.clone(), Some(pos)),
        _ => {
            let taken: Vec<String> = all.iter().map(|s| s.id.clone()).collect();
            (unique_id(&package.name, &taken), None)
        }
    };

    let dir = skills_dir().join(&id);
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    for (rel, bytes) in &package.files {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, bytes)?;
    }

    let skill = Skill { id, name: package.name.clone(), description: package.description.clone(), source: "friend".into(), written_by: None };
    match replacing {
        Some(pos) => all[pos] = skill.clone(),
        None => all.push(skill.clone()),
    }
    save(store, "skills", &all)?;
    Ok(skill)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_skill(store: &crate::store::Store, id: &str, name: &str) {
        let dir = skills_dir().join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), format!("---\nname: {name}\n---\nDo the thing.")).unwrap();
        let mut all = skills(store);
        all.push(Skill { id: id.into(), name: name.into(), description: "desc".into(), source: "custom".into(), written_by: None });
        save(store, "skills", &all).unwrap();
    }

    #[test]
    fn exporting_then_importing_under_a_new_name_round_trips_the_files() {
        let store = crate::store::Store::open(Path::new(":memory:")).unwrap();
        write_skill(&store, "sk1", "我的技能");
        let package = export(&store, "sk1").unwrap();
        assert_eq!(package.files.len(), 1);

        let imported = import(&store, &package, Conflict::KeepBoth).unwrap();
        assert_ne!(imported.id, "sk1");
        assert_eq!(imported.source, "friend");
        let content = fs::read_to_string(imported.dir().join("SKILL.md")).unwrap();
        assert!(content.contains("Do the thing."));
    }

    #[test]
    fn a_name_collision_with_keep_both_installs_a_second_copy_under_a_fresh_id() {
        let store = crate::store::Store::open(Path::new(":memory:")).unwrap();
        write_skill(&store, "sk1", "重名技能");
        let package = export(&store, "sk1").unwrap();

        let imported = import(&store, &package, Conflict::KeepBoth).unwrap();
        assert_ne!(imported.id, "sk1");
        assert_eq!(skills(&store).len(), 2);
    }

    #[test]
    fn a_name_collision_with_overwrite_replaces_the_existing_skill_in_place() {
        let store = crate::store::Store::open(Path::new(":memory:")).unwrap();
        write_skill(&store, "sk1", "重名技能");
        let mut package = export(&store, "sk1").unwrap();
        package.description = "更新后的说明".into();

        let imported = import(&store, &package, Conflict::Overwrite).unwrap();
        assert_eq!(imported.id, "sk1");
        assert_eq!(skills(&store).len(), 1);
        assert_eq!(skills(&store)[0].description, "更新后的说明");
    }

    #[test]
    fn an_empty_package_is_rejected() {
        let store = crate::store::Store::open(Path::new(":memory:")).unwrap();
        let empty = SkillPackage { name: "空".into(), description: String::new(), files: Vec::new() };
        assert!(import(&store, &empty, Conflict::KeepBoth).is_err());
    }
}
