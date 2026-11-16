//! Restricted Python literal reader. Never executes Python or imports project code.
use crate::{Error, Result};

use serde_json::{Map, Number, Value};

pub fn parse(input: &str) -> Result<Value> {
    let mut p = Parser {
        chars: input.chars().collect(),
        i: 0,
    };

    let v = p.value()?;

    p.space();

    if p.i != p.chars.len() {
        return Err(Error::Invalid("trailing literal input".into()));
    }
    Ok(v)
}
struct Parser {
    chars: Vec<char>,
    i: usize,
}
impl Parser {
    fn space(&mut self) {
        while self.chars.get(self.i).is_some_and(|c| c.is_whitespace()) {
            self.i += 1;
        }
    }
    fn take(&mut self, c: char) -> bool {
        self.space();

        if self.chars.get(self.i) == Some(&c) {
            self.i += 1;

            true
        } else {
            false
        }
    }
    fn value(&mut self) -> Result<Value> {
        self.space();

        let c = *self
            .chars
            .get(self.i)
            .ok_or_else(|| Error::Invalid("incomplete literal".into()))?;

        match c {
            '{' => {
                self.i += 1;

                let mut m = Map::new();

                while !self.take('}') {
                    let k = self.value()?;

                    if !self.take(':') {
                        return Err(Error::Invalid("expected colon".into()));
                    }
                    let v = self.value()?;

                    m.insert(
                        k.as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| k.to_string()),
                        v,
                    );

                    if !self.take(',') && !self.take('}') {
                        return Err(Error::Invalid("expected comma".into()));
                    } else if self.chars.get(self.i.wrapping_sub(1)) == Some(&'}') {
                        break;
                    }
                }
                Ok(m.into())
            }
            '[' | '(' => {
                self.i += 1;

                let close = if c == '[' { ']' } else { ')' };

                let mut a = vec![];

                while !self.take(close) {
                    a.push(self.value()?);

                    if !self.take(',') {
                        if self.take(close) {
                            break;
                        }
                        return Err(Error::Invalid("expected sequence delimiter".into()));
                    }
                }
                Ok(a.into())
            }
            '\'' | '"' => {
                self.i += 1;

                let mut s = String::new();

                loop {
                    let ch = *self
                        .chars
                        .get(self.i)
                        .ok_or_else(|| Error::Invalid("unclosed string".into()))?;

                    self.i += 1;

                    if ch == c {
                        break;
                    }
                    if ch == '\\' {
                        let e = *self
                            .chars
                            .get(self.i)
                            .ok_or_else(|| Error::Invalid("incomplete escape".into()))?;

                        self.i += 1;

                        s.push(match e {
                            'n' => '\n',
                            'r' => '\r',
                            't' => '\t',
                            _ => e,
                        });
                    } else {
                        s.push(ch);
                    }
                }
                Ok(s.into())
            }
            _ => {
                let start = self.i;

                while self
                    .chars
                    .get(self.i)
                    .is_some_and(|c| !c.is_whitespace() && !['}', ']', ')', ',', ':'].contains(c))
                {
                    self.i += 1;
                }
                let token: String = self.chars[start..self.i].iter().collect();

                match token.as_str() {
                    "True" => Ok(true.into()),
                    "False" => Ok(false.into()),
                    "None" | "nan" => Ok(Value::Null),
                    _ => {
                        if let Ok(n) = token.parse::<i64>() {
                            Ok(n.into())
                        } else {
                            token
                                .parse::<f64>()
                                .ok()
                                .and_then(Number::from_f64)
                                .map(Value::Number)
                                .ok_or_else(|| {
                                    Error::Invalid(format!("unsupported literal {token}"))
                                })
                        }
                    }
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn literals() {
        let v = super::parse(
            "({'left': {'N2O': {'start': 2, 'stop': 100}},
 'exclude': True},
 {})",
        )
        .expect("literal");

        assert_eq!(v[0]["left"]["N2O"]["start"], 2);

        assert_eq!(v[0]["exclude"], true);

        assert!(super::parse("__import__('os')").is_err());
    }
}
