pub mod api;
pub mod diagnostics;
pub mod literal;
pub mod parity;
pub mod raw;
pub mod regression;
pub mod session;
pub use api::*;
pub use session::Session;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Pickle(#[from] serde_pickle::Error),
}
pub type Result<T> = std::result::Result<T, Error>;
