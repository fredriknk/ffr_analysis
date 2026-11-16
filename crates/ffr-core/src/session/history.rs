use super::*;

impl Session {
    pub(super) fn log(
        &self,
        kind: &str,
        target: Option<i64>,
        before: &Value,
        after: &Value,
        action: &str,
        original: Option<i64>,
    ) -> Result<()> {
        self.db()?.execute("INSERT INTO changes(time,kind,before,after,target,action,original) VALUES(?1,?2,?3,?4,?5,?6,?7)",
params![chrono::Utc::now().timestamp_millis(),
kind,
before.to_string(),
after.to_string(),
target,
action,
original])?;

        Ok(())
    }

    pub(super) fn history_value(&self, limit: usize) -> Result<Vec<Value>> {
        let mut q=self.db()?.prepare("SELECT id,time,kind,before,after,target,action,original FROM changes ORDER BY id DESC LIMIT ?1")?;
        let rows = q
            .query_map([limit], |r| {
                Ok(json!({
                "id":r.get::<_,
                i64>(0)?,
                "time":r.get::<_,
                i64>(1)?,
                "kind":r.get::<_,
                String>(2)?,
                "before":r.get::<_,
                String>(3)?,
                "after":r.get::<_,
                String>(4)?,
                "target":r.get::<_,
                Option<i64>>(5)?,
                "action":r.get::<_,
                String>(6)?,
                "original":r.get::<_,
                Option<i64>>(7)?}
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    pub fn undo(&self) -> Result<UndoResult> {
        let changed = self.travel(false)?["changed"] == true;
        self.undo_state(changed)
    }

    pub fn redo(&self) -> Result<UndoResult> {
        let changed = self.travel(true)?["changed"] == true;
        self.undo_state(changed)
    }

    pub(super) fn travel(&self, redo: bool) -> Result<Value> {
        let history_value = self.history_value(usize::MAX / 2)?;
        let mut undone = std::collections::BTreeSet::new();
        let mut redos = vec![];
        for h in history_value.iter().rev() {
            let id = h["id"].as_i64().unwrap_or(0);
            let original = h["original"].as_i64().unwrap_or(0);
            match h["action"].as_str() {
                Some("edit") => {
                    redos.clear();
                }
                Some("undo") => {
                    undone.insert(original);
                    redos.push(original);
                }
                Some("redo") => {
                    undone.remove(&original);
                    redos.retain(|v| *v != original);
                }
                _ => {}
            }
            let _ = id;
        }
        let chosen = if redo {
            redos
                .last()
                .and_then(|id| history_value.iter().find(|h| h["id"] == *id))
        } else {
            history_value
                .iter()
                .find(|h| h["action"] == "edit" && !undone.contains(&h["id"].as_i64().unwrap_or(0)))
        };
        let Some(h) = chosen else {
            return Ok(json!({"changed":false}));
        };
        let key = if redo { "after" } else { "before" };
        let v: Value = serde_json::from_str(h[key].as_str().unwrap_or("null"))?;
        let kind = h["kind"].as_str().unwrap_or("");
        let target = h["target"].as_i64();
        let tx = self.db()?.unchecked_transaction()?;
        match kind {
            "optionsBatch" | "flagsBatch" => {
                for entry in v.as_array().unwrap_or(&vec![]) {
                    let id = entry["id"].as_i64().unwrap_or(0);
                    if kind == "optionsBatch" {
                        let o = &entry["options"];
                        self.db()?.execute(
                            "UPDATE fluxes SET options=?2 WHERE id=?1",
                            params![
                                id,
                                if o.is_null() {
                                    None
                                } else {
                                    Some(o.to_string())
                                }
                            ],
                        )?;
                    } else {
                        self.write_row(id, &serde_json::from_value(entry.clone())?)?;
                    }
                    self.recompute_one(id)?;
                }
            }
            "config" | "layout" => {
                self.db()?.execute(
                    "UPDATE meta SET value=?2 WHERE key=?1",
                    params![kind, v.to_string()],
                )?;
                if kind == "config" {
                    if let Some(name) = v["name"].as_str().filter(|s| !s.is_empty()) {
                        self.db()?
                            .execute("UPDATE meta SET value=?1 WHERE key='name'", [name])?;
                    }
                }
                self.recompute_all(|_| {})?;
            }
            "options" => {
                self.db()?.execute(
                    "UPDATE fluxes SET options=?2 WHERE id=?1",
                    params![
                        target,
                        if v.is_null() {
                            None
                        } else {
                            Some(v.to_string())
                        }
                    ],
                )?;
                self.recompute_one(target.unwrap_or(0))?;
            }
            "flags" => {
                self.write_row(target.unwrap_or(0), &serde_json::from_value(v.clone())?)?;
                self.recompute_one(target.unwrap_or(0))?;
            }
            _ => {}
        }
        self.log(
            kind,
            target,
            &serde_json::from_str::<Value>(h["before"].as_str().unwrap_or("null"))?,
            &serde_json::from_str::<Value>(h["after"].as_str().unwrap_or("null"))?,
            if redo { "redo" } else { "undo" },
            h["id"].as_i64(),
        )?;
        self.neighbour_pass()?;
        tx.commit()?;
        Ok(json!({
        "changed":true,
        "fluxIds":if let Some(entries)=v.as_array(){
        entries.iter().filter_map(|e|e["id"].as_i64()).collect::<Vec<_>>()}
        else{
        target.into_iter().collect::<Vec<_>>()}
        }
        ))
    }

    pub fn history(&self, limit: usize) -> Result<Vec<Change>> {
        self.history_value(limit)?
            .into_iter()
            .map(|h| {
                let before = h["before"].as_str().unwrap_or("null").to_owned();
                let after = h["after"].as_str().unwrap_or("null").to_owned();
                let v: Value = serde_json::from_str(&after)?;
                let flux_ids = if let Some(a) = v.as_array() {
                    a.iter().filter_map(|v| v["id"].as_i64()).collect()
                } else {
                    h["target"].as_i64().into_iter().collect()
                };
                Ok(Change {
                    id: h["id"].as_i64().unwrap_or(0),
                    time: h["time"].as_i64().unwrap_or(0),
                    kind: h["kind"].as_str().unwrap_or("").into(),
                    flux_ids,
                    before,
                    after,
                })
            })
            .collect()
    }

    pub(super) fn undo_state(&self, changed: bool) -> Result<UndoResult> {
        let h = self.history_value(usize::MAX / 2)?;
        let mut undo = vec![];
        let mut redo = vec![];
        for h in h.iter().rev() {
            match h["action"].as_str() {
                Some("edit") => {
                    undo.push(h["id"].as_i64().unwrap_or(0));
                    redo.clear();
                }
                Some("undo") => {
                    if let Some(id) = h["original"].as_i64() {
                        undo.retain(|v| *v != id);
                        redo.push(id);
                    }
                }
                Some("redo") => {
                    if let Some(id) = h["original"].as_i64() {
                        redo.retain(|v| *v != id);
                        undo.push(id);
                    }
                }
                _ => {}
            }
        }
        Ok(UndoResult {
            changed,
            can_undo: !undo.is_empty(),
            can_redo: !redo.is_empty(),
        })
    }
}
