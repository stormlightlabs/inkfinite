//! Stable identifiers and scalar document versions.

use std::fmt;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

macro_rules! string_id {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(Clone, Debug, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
        #[serde(transparent)]
        #[ts(type = "string")]
        pub struct $name(String);

        impl $name {
            /// Creates an identifier from its stable serialized value.
            #[must_use]
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            /// Returns the stable serialized value.
            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_owned())
            }
        }
    };
}

string_id!(DocumentId, "Stable identifier for a document.");
string_id!(PageId, "Stable identifier for a page.");
string_id!(LayerId, "Stable identifier for a layer.");
string_id!(ShapeId, "Stable identifier for a shape.");
string_id!(BindingId, "Stable identifier for a binding.");
string_id!(AssetId, "Stable identifier for an embedded or linked asset.");
string_id!(ActorId, "Stable identifier for a human, agent, or system actor.");
string_id!(ChangeHash, "Opaque causal hash supplied by the CRDT implementation.");
string_id!(FormatId, "Stable identifier for a serialized contract.");
string_id!(ShapeKind, "Registry key for a shape definition.");
string_id!(BindingKind, "Registry key for a binding definition.");

/// Milliseconds since the Unix epoch.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
#[serde(transparent)]
#[ts(type = "number")]
pub struct Timestamp(pub i64);

/// Monotonic version of a record within the document history.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
#[serde(transparent)]
#[ts(type = "number")]
pub struct RecordVersion(pub u64);
