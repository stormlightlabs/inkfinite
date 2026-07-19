#![forbid(unsafe_code)]

//! Transport-neutral peer synchronization for Inkfinite documents.
//!
//! Automerge owns the change exchange protocol, while this module owns the
//! Inkfinite envelope, peer identity checks, bounded retry state, and durable
//! checkpoints. A transport only needs to deliver [`SyncMessage`] values and
//! does not need to understand Automerge.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::crdt::{AutomergeDocument, AutomergeSyncSession, CrdtDocument, CrdtError, SyncSession};
use crate::{ActorId, ChangeHash, DocumentId};

/// Stable identifier for the peer synchronization envelope.
pub const SYNC_PROTOCOL_ID: &str = "inkfinite.sync";
/// Version of the peer synchronization envelope.
pub const SYNC_PROTOCOL_VERSION: u32 = 1;
/// Maximum encoded Automerge sync payload accepted from a peer.
pub const MAX_SYNC_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;
/// Maximum number of messages retained while a transport is delayed or
/// reordered.
pub const MAX_PENDING_SYNC_MESSAGES: usize = 64;
/// Maximum encoded payload bytes retained while a transport is delayed or
/// reordered.
pub const MAX_PENDING_SYNC_BYTES: usize = 8 * 1024 * 1024;
/// Maximum number of peer checkpoints retained for one document.
pub const MAX_SYNC_PEERS: usize = 32;

const MAX_RECEIVED_SEQUENCES: usize = 4096;

/// One transport-independent Automerge sync message.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncMessage {
    /// Stable envelope identifier.
    pub protocol_id: String,
    /// Envelope version.
    pub version: u32,
    /// Document this message belongs to.
    pub document_id: DocumentId,
    /// Actor that produced the message.
    pub sender: ActorId,
    /// Trusted peer that should receive the message.
    pub recipient: ActorId,
    /// Monotonic sequence assigned by the sending peer checkpoint.
    pub sequence: u64,
    /// Opaque Automerge sync payload.
    pub payload: Vec<u8>,
}

impl SyncMessage {
    fn validate(
        &self, document_id: &DocumentId, local_actor: &ActorId, expected_peer: &ActorId,
    ) -> Result<(), SyncError> {
        if self.protocol_id != SYNC_PROTOCOL_ID || self.version != SYNC_PROTOCOL_VERSION {
            return Err(SyncError::UnsupportedProtocol {
                protocol_id: self.protocol_id.clone(),
                version: self.version,
            });
        }
        if self.document_id != *document_id {
            return Err(SyncError::DocumentMismatch {
                expected: document_id.clone(),
                actual: self.document_id.clone(),
            });
        }
        if self.sender != *expected_peer {
            return Err(SyncError::PeerMismatch { expected: expected_peer.clone(), actual: self.sender.clone() });
        }
        if self.recipient != *local_actor {
            return Err(SyncError::WrongRecipient { expected: local_actor.clone(), actual: self.recipient.clone() });
        }
        if self.sequence == 0 {
            return Err(SyncError::InvalidSequence);
        }
        if self.payload.is_empty() {
            return Err(SyncError::EmptyPayload);
        }
        if self.payload.len() > MAX_SYNC_PAYLOAD_BYTES {
            return Err(SyncError::PayloadTooLarge { size: self.payload.len() });
        }
        Ok(())
    }
}

/// Public state of a trusted peer checkpoint.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PeerSyncStatus {
    /// Trusted actor identity for the peer.
    pub peer_id: ActorId,
    /// Messages waiting for a delayed dependency or transport delivery.
    pub pending_messages: usize,
    /// Causal heads the Automerge protocol knows are shared.
    pub shared_heads: Vec<ChangeHash>,
    /// Most recently quarantined message, if any.
    pub quarantine: Option<SyncQuarantine>,
}

/// A malformed or invalid peer message retained for diagnostics.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SyncQuarantine {
    /// Sequence of the rejected message.
    pub sequence: u64,
    /// Stable human-readable reason for the rejection.
    pub reason: String,
}

/// Result classification for one received peer message.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncDisposition {
    /// At least one new Automerge message was adopted.
    Applied,
    /// The message sequence was already processed or is already queued.
    Duplicate,
    /// The message is valid but is waiting for another delayed message.
    Deferred,
    /// The payload was rejected and retained as quarantine metadata.
    Quarantined,
}

/// Result of receiving one peer envelope before document-level validation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PeerReceiveResult {
    /// Classification of the received message.
    pub disposition: SyncDisposition,
    /// Number of queued messages successfully applied while draining pending
    /// dependencies.
    pub applied_messages: usize,
}

/// Recoverable failure at the trusted peer boundary.
#[derive(Debug, Error)]
pub enum SyncError {
    /// The Automerge adapter rejected or could not decode a payload.
    #[error(transparent)]
    Crdt(#[from] CrdtError),
    /// The envelope protocol is not supported by this peer.
    #[error("unsupported sync protocol {protocol_id:?} version {version}")]
    UnsupportedProtocol { protocol_id: String, version: u32 },
    /// The message belongs to another document.
    #[error("sync message targets document {actual}, expected {expected}")]
    DocumentMismatch { expected: DocumentId, actual: DocumentId },
    /// The message came from another actor than the connected peer.
    #[error("sync message came from peer {actual}, expected {expected}")]
    PeerMismatch { expected: ActorId, actual: ActorId },
    /// The message is addressed to another local actor.
    #[error("sync message targets actor {actual}, expected {expected}")]
    WrongRecipient { expected: ActorId, actual: ActorId },
    /// Sequence zero is reserved for an uninitialized envelope.
    #[error("sync message sequence must be greater than zero")]
    InvalidSequence,
    /// A sync envelope must carry an encoded Automerge message.
    #[error("sync message payload is empty")]
    EmptyPayload,
    /// An encoded Automerge message exceeded the peer boundary.
    #[error("sync payload is {size} bytes; the limit is {MAX_SYNC_PAYLOAD_BYTES}")]
    PayloadTooLarge { size: usize },
    /// A peer ID cannot be empty or equal to the local actor.
    #[error("sync peer ID is invalid: {0}")]
    InvalidPeer(String),
    /// The document has reached its bounded peer checkpoint limit.
    #[error("the document already has {MAX_SYNC_PEERS} sync peers")]
    PeerLimit,
    /// A message operation referenced a peer that is not connected.
    #[error("sync peer {peer_id} is not connected")]
    PeerNotConnected { peer_id: ActorId },
    /// The peer has too many delayed messages queued.
    #[error("sync peer pending-message limit exceeded")]
    PendingLimit,
    /// A persisted peer checkpoint could not be decoded safely.
    #[error("invalid persisted sync state: {0}")]
    InvalidState(String),
}

/// A serializable per-peer checkpoint used by the file boundary.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersistedPeerSync {
    /// Trusted actor identity for the peer.
    pub peer_id: ActorId,
    /// Compact Automerge synchronization checkpoint.
    pub state: Vec<u8>,
    /// Sequence to assign to the next outgoing message.
    pub next_sequence: u64,
    /// Bounded sequence window used for duplicate suppression.
    pub received_sequences: Vec<u64>,
    /// Bounded messages waiting for delayed dependencies.
    pub pending_messages: Vec<SyncMessage>,
    /// Most recently quarantined payload.
    pub quarantine: Option<SyncQuarantine>,
}

/// Current synchronization state for a document.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct SyncStatus {
    /// Connected trusted peers in stable actor order.
    pub peers: Vec<PeerSyncStatus>,
    /// A persisted checkpoint warning that did not invalidate the document.
    pub warning: Option<String>,
}

/// State for one trusted peer and one local document replica.
#[derive(Clone)]
pub struct PeerSync {
    peer_id: ActorId,
    session: AutomergeSyncSession,
    next_sequence: u64,
    received_sequences: BTreeSet<u64>,
    received_order: VecDeque<u64>,
    pending_messages: BTreeMap<u64, SyncMessage>,
    pending_bytes: usize,
    quarantine: Option<SyncQuarantine>,
}

impl PeerSync {
    /// Creates a fresh checkpoint for a trusted peer.
    ///
    /// # Errors
    ///
    /// Returns [`SyncError::InvalidPeer`] for an empty actor ID.
    pub fn new(peer_id: ActorId) -> Result<Self, SyncError> {
        validate_peer_id(&peer_id)?;
        Ok(Self {
            peer_id,
            session: AutomergeSyncSession::new(),
            next_sequence: 1,
            received_sequences: BTreeSet::new(),
            received_order: VecDeque::new(),
            pending_messages: BTreeMap::new(),
            pending_bytes: 0,
            quarantine: None,
        })
    }

    /// Restores a bounded checkpoint after a process restart.
    ///
    /// # Errors
    ///
    /// Returns [`SyncError::InvalidState`] when the encoded checkpoint or its
    /// bounded queues cannot be trusted.
    pub fn from_persisted(value: PersistedPeerSync) -> Result<Self, SyncError> {
        validate_peer_id(&value.peer_id)?;
        if value.next_sequence == 0 {
            return Err(SyncError::InvalidState(
                "next sequence must be greater than zero".into(),
            ));
        }
        if value.received_sequences.len() > MAX_RECEIVED_SEQUENCES {
            return Err(SyncError::InvalidState("received sequence window is too large".into()));
        }
        if value
            .quarantine
            .as_ref()
            .is_some_and(|quarantine| quarantine.sequence == 0)
        {
            return Err(SyncError::InvalidState(
                "quarantine sequence must be greater than zero".into(),
            ));
        }
        let session = AutomergeSyncSession::from_encoded_state(&value.state)
            .map_err(|error| SyncError::InvalidState(error.to_string()))?;
        let mut peer = Self {
            peer_id: value.peer_id,
            session,
            next_sequence: value.next_sequence,
            received_sequences: BTreeSet::new(),
            received_order: VecDeque::new(),
            pending_messages: BTreeMap::new(),
            pending_bytes: 0,
            quarantine: value.quarantine,
        };
        for sequence in value.received_sequences {
            if sequence == 0 || !peer.received_sequences.insert(sequence) {
                return Err(SyncError::InvalidState(
                    "received sequence window contains a duplicate or zero".into(),
                ));
            }
            peer.received_order.push_back(sequence);
        }
        for message in value.pending_messages {
            message.validate_pending(&peer.peer_id)?;
            if peer.received_sequences.contains(&message.sequence) {
                return Err(SyncError::InvalidState(
                    "pending message sequence is already marked received".into(),
                ));
            }
            if peer
                .pending_messages
                .insert(message.sequence, message.clone())
                .is_some()
            {
                return Err(SyncError::InvalidState(
                    "pending messages contain a duplicate sequence".into(),
                ));
            }
            peer.pending_bytes = peer
                .pending_bytes
                .checked_add(message.payload.len())
                .ok_or_else(|| SyncError::InvalidState("pending payload size overflow".into()))?;
            if peer.pending_messages.len() > MAX_PENDING_SYNC_MESSAGES || peer.pending_bytes > MAX_PENDING_SYNC_BYTES {
                return Err(SyncError::InvalidState(
                    "pending message queue exceeds its bound".into(),
                ));
            }
        }
        Ok(peer)
    }

    /// Serializes the bounded checkpoint for persistence.
    #[must_use]
    pub fn persisted(&self) -> PersistedPeerSync {
        PersistedPeerSync {
            peer_id: self.peer_id.clone(),
            state: self.session.encoded_state(),
            next_sequence: self.next_sequence,
            received_sequences: self.received_order.iter().copied().collect(),
            pending_messages: self.pending_messages.values().cloned().collect(),
            quarantine: self.quarantine.clone(),
        }
    }

    /// Returns the trusted peer actor ID.
    #[must_use]
    pub fn peer_id(&self) -> &ActorId {
        &self.peer_id
    }

    /// Returns a stable status projection without exposing Automerge types.
    #[must_use]
    pub fn status(&self) -> PeerSyncStatus {
        PeerSyncStatus {
            peer_id: self.peer_id.clone(),
            pending_messages: self.pending_messages.len(),
            shared_heads: self.session.shared_heads(),
            quarantine: self.quarantine.clone(),
        }
    }

    /// Produces the next outgoing message for this peer.
    ///
    /// Automerge suppresses messages until its previous in-flight exchange is
    /// acknowledged, so callers can safely poll this method after reconnects.
    ///
    /// # Errors
    ///
    /// Returns a typed CRDT or sequence-boundary error.
    pub fn next_message(&mut self, document: &mut AutomergeDocument) -> Result<Option<SyncMessage>, SyncError> {
        let Some(payload) = self.session.generate_message(document)? else {
            return Ok(None);
        };
        if payload.len() > MAX_SYNC_PAYLOAD_BYTES {
            return Err(SyncError::PayloadTooLarge { size: payload.len() });
        }
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.checked_add(1).ok_or(SyncError::InvalidSequence)?;
        Ok(Some(SyncMessage {
            protocol_id: SYNC_PROTOCOL_ID.into(),
            version: SYNC_PROTOCOL_VERSION,
            document_id: document_id(document)?,
            sender: document.actor_id(),
            recipient: self.peer_id.clone(),
            sequence,
            payload,
        }))
    }

    /// Receives one message, retrying queued messages whose dependencies have
    /// arrived and quarantining malformed payloads without mutating the live
    /// document on its own.
    ///
    /// The transaction engine calls this on a document fork, validates and
    /// repairs that fork, and adopts both states together.
    ///
    /// # Errors
    ///
    /// Returns an error for an envelope addressed to another document, actor,
    /// or peer, or when the bounded pending queue is full.
    pub fn receive_message(
        &mut self, document: &mut AutomergeDocument, message: &SyncMessage,
    ) -> Result<PeerReceiveResult, SyncError> {
        let document_id = document_id(document)?;
        message.validate(&document_id, &document.actor_id(), &self.peer_id)?;
        if self.received_sequences.contains(&message.sequence) || self.pending_messages.contains_key(&message.sequence)
        {
            return Ok(PeerReceiveResult { disposition: SyncDisposition::Duplicate, applied_messages: 0 });
        }
        if self.pending_messages.len() >= MAX_PENDING_SYNC_MESSAGES
            || self.pending_bytes.saturating_add(message.payload.len()) > MAX_PENDING_SYNC_BYTES
        {
            return Err(SyncError::PendingLimit);
        }
        self.pending_bytes += message.payload.len();
        self.pending_messages.insert(message.sequence, message.clone());

        let mut applied_messages = 0;
        let mut quarantined = false;
        loop {
            let pending = self.pending_messages.values().cloned().collect::<Vec<_>>();
            let mut made_progress = false;
            for pending_message in pending {
                let mut candidate_document = document.clone();
                let mut candidate_session = self.session.clone();
                match candidate_session.receive_message_with_status(&mut candidate_document, &pending_message.payload) {
                    Ok(true) => {
                        *document = candidate_document;
                        self.session = candidate_session;
                        self.remove_pending(pending_message.sequence);
                        self.record_received(pending_message.sequence);
                        applied_messages += 1;
                        made_progress = true;
                    }
                    Ok(false) => {}
                    Err(error) if missing_dependency(&error) => {}
                    Err(error) => {
                        self.remove_pending(pending_message.sequence);
                        self.record_received(pending_message.sequence);
                        self.quarantine =
                            Some(SyncQuarantine { sequence: pending_message.sequence, reason: error.to_string() });
                        quarantined = true;
                        made_progress = true;
                    }
                }
            }
            if !made_progress {
                break;
            }
        }

        let disposition = if quarantined {
            SyncDisposition::Quarantined
        } else if applied_messages > 0 {
            SyncDisposition::Applied
        } else {
            SyncDisposition::Deferred
        };
        Ok(PeerReceiveResult { disposition, applied_messages })
    }

    fn remove_pending(&mut self, sequence: u64) {
        if let Some(message) = self.pending_messages.remove(&sequence) {
            self.pending_bytes = self.pending_bytes.saturating_sub(message.payload.len());
        }
    }

    fn record_received(&mut self, sequence: u64) {
        if self.received_sequences.insert(sequence) {
            self.received_order.push_back(sequence);
        }
        while self.received_order.len() > MAX_RECEIVED_SEQUENCES {
            if let Some(expired) = self.received_order.pop_front() {
                self.received_sequences.remove(&expired);
            }
        }
    }
}

impl SyncMessage {
    fn validate_pending(&self, peer_id: &ActorId) -> Result<(), SyncError> {
        if self.protocol_id != SYNC_PROTOCOL_ID || self.version != SYNC_PROTOCOL_VERSION {
            return Err(SyncError::InvalidState(
                "pending message has an unsupported protocol".into(),
            ));
        }
        if self.sender != *peer_id || self.recipient.as_str().trim().is_empty() || self.sequence == 0 {
            return Err(SyncError::InvalidState("pending message identity is invalid".into()));
        }
        if self.payload.is_empty() || self.payload.len() > MAX_SYNC_PAYLOAD_BYTES {
            return Err(SyncError::InvalidState(
                "pending message payload is outside its bounds".into(),
            ));
        }
        Ok(())
    }
}

impl PersistedPeerSync {
    /// Validates persisted pending envelopes against their owning document and
    /// local actor before the checkpoint is restored.
    pub(crate) fn validate_for(&self, document_id: &DocumentId, local_actor: &ActorId) -> Result<(), SyncError> {
        for message in &self.pending_messages {
            message.validate(document_id, local_actor, &self.peer_id)?;
        }
        Ok(())
    }
}

fn validate_peer_id(peer_id: &ActorId) -> Result<(), SyncError> {
    if peer_id.as_str().trim().is_empty() {
        Err(SyncError::InvalidPeer("actor ID must not be empty".into()))
    } else {
        Ok(())
    }
}

fn document_id(document: &mut AutomergeDocument) -> Result<DocumentId, SyncError> {
    // The sync envelope needs the stable ID but the CRDT adapter intentionally
    // exposes only the materialized snapshot at this boundary.
    Ok(document.snapshot()?.document_id)
}

fn missing_dependency(error: &CrdtError) -> bool {
    matches!(
        error,
        CrdtError::Automerge(source) if matches!(source.as_ref(), automerge::AutomergeError::MissingDeps)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crdt::CrdtDocument;
    use crate::engine::{TransactionDraft, TransactionEngine};
    use crate::proto::{Operation, TransactionId};
    use crate::{Origin, RecordVersion, Timestamp, blank_document};
    use automerge::transaction::Transactable;
    use proptest::prelude::*;

    fn rename(engine: &mut TransactionEngine, actor_id: ActorId, name: &str) {
        let snapshot = engine.snapshot().expect("snapshot");
        engine
            .commit(TransactionDraft {
                id: TransactionId(format!("transaction:{name}")),
                actor_id,
                origin: Origin::Human,
                base_heads: snapshot.heads,
                description: name.into(),
                operations: vec![Operation::RenamePage {
                    page_id: snapshot.document.page_ids[0].clone(),
                    name: name.into(),
                    expected_version: Some(RecordVersion(1)),
                }],
                timestamp: Timestamp(1),
            })
            .expect("rename");
    }

    fn exchange_until_idle(
        left: &mut TransactionEngine, left_peer: &mut PeerSync, right: &mut TransactionEngine,
        right_peer: &mut PeerSync,
    ) {
        for _ in 0..64 {
            let left_message = left.next_sync_message(left_peer).expect("left message");
            let right_message = right.next_sync_message(right_peer).expect("right message");
            let idle = left_message.is_none() && right_message.is_none();
            if let Some(message) = left_message {
                right.receive_sync_message(right_peer, &message).expect("left to right");
            }
            if let Some(message) = right_message {
                left.receive_sync_message(left_peer, &message).expect("right to left");
            }
            if idle {
                break;
            }
        }
    }

    #[test]
    fn peer_envelope_rejects_wrong_document_and_recipient() {
        let document_id = DocumentId::from("document:sync");
        let mut document = AutomergeDocument::create(
            document_id.clone(),
            ActorId::from("actor:left"),
            blank_document(&document_id, None),
        )
        .expect("document");
        let mut peer = PeerSync::new(ActorId::from("actor:right")).expect("peer");
        let mut right_document = AutomergeDocument::create(
            document_id.clone(),
            ActorId::from("actor:right"),
            blank_document(&document_id, None),
        )
        .expect("right document");
        let mut right_peer = PeerSync::new(ActorId::from("actor:left")).expect("right peer");
        let message = right_peer
            .next_message(&mut right_document)
            .expect("message generation")
            .expect("handshake");
        let mut wrong = message.clone();
        wrong.document_id = DocumentId::from("document:other");
        assert!(matches!(
            peer.receive_message(&mut document, &wrong),
            Err(SyncError::DocumentMismatch { .. })
        ));
        let mut wrong_recipient = message;
        wrong_recipient.recipient = ActorId::from("actor:other");
        assert!(matches!(
            peer.receive_message(&mut document, &wrong_recipient),
            Err(SyncError::WrongRecipient { .. })
        ));
    }

    #[test]
    fn persisted_peer_state_is_bounded_and_round_trips() {
        let peer = PeerSync::new(ActorId::from("actor:right")).expect("peer");
        let persisted = peer.persisted();
        let restored = PeerSync::from_persisted(persisted).expect("restore");
        assert_eq!(restored.status(), peer.status());
    }

    #[test]
    fn two_engines_exchange_only_protocol_messages_and_converge() {
        let document_id = DocumentId::from("document:sync");
        let mut left = TransactionEngine::create(
            document_id.clone(),
            ActorId::from("actor:left"),
            blank_document(&document_id, None),
        )
        .expect("left");
        let mut right =
            TransactionEngine::load(&left.save().expect("save"), ActorId::from("actor:right")).expect("right");
        rename(&mut left, ActorId::from("actor:left"), "left");
        rename(&mut right, ActorId::from("actor:right"), "right");
        let mut left_peer = PeerSync::new(ActorId::from("actor:right")).expect("left peer");
        let mut right_peer = PeerSync::new(ActorId::from("actor:left")).expect("right peer");

        exchange_until_idle(&mut left, &mut left_peer, &mut right, &mut right_peer);
        assert_eq!(
            left.snapshot().expect("left snapshot"),
            right.snapshot().expect("right snapshot")
        );
        assert_eq!(left_peer.status().pending_messages, 0);
        assert_eq!(right_peer.status().pending_messages, 0);
    }

    #[test]
    fn corrupt_payload_is_quarantined_and_duplicate_delivery_is_harmless() {
        let document_id = DocumentId::from("document:sync-corrupt");
        let mut left = TransactionEngine::create(
            document_id.clone(),
            ActorId::from("actor:left"),
            blank_document(&document_id, None),
        )
        .expect("left");
        let mut right =
            TransactionEngine::load(&left.save().expect("save"), ActorId::from("actor:right")).expect("right");
        rename(&mut right, ActorId::from("actor:right"), "right edit");
        let mut left_peer = PeerSync::new(ActorId::from("actor:right")).expect("left peer");
        let mut right_peer = PeerSync::new(ActorId::from("actor:left")).expect("right peer");
        let message = right
            .next_sync_message(&mut right_peer)
            .expect("message")
            .expect("message");
        let before = left.snapshot().expect("before");
        let mut corrupt = message.clone();
        corrupt.payload[0] ^= 0xff;

        let result = left
            .receive_sync_message(&mut left_peer, &corrupt)
            .expect("quarantine is recoverable");
        assert_eq!(result.disposition, SyncDisposition::Quarantined);
        assert_eq!(result.adopted_messages, 0);
        assert_eq!(left.snapshot().expect("after"), before);
        assert_eq!(left_peer.status().quarantine.unwrap().sequence, message.sequence);

        let duplicate = left
            .receive_sync_message(&mut left_peer, &corrupt)
            .expect("duplicate quarantine delivery");
        assert_eq!(duplicate.disposition, SyncDisposition::Duplicate);
        assert_eq!(left.snapshot().expect("after duplicate"), before);
    }

    #[test]
    fn reordered_and_duplicated_messages_still_converge() {
        let document_id = DocumentId::from("document:sync-reordered");
        let mut left = TransactionEngine::create(
            document_id.clone(),
            ActorId::from("actor:left"),
            blank_document(&document_id, None),
        )
        .expect("left");
        let mut right =
            TransactionEngine::load(&left.save().expect("save"), ActorId::from("actor:right")).expect("right");
        rename(&mut left, ActorId::from("actor:left"), "left edit");
        rename(&mut right, ActorId::from("actor:right"), "right edit");
        let mut left_peer = PeerSync::new(ActorId::from("actor:right")).expect("left peer");
        let mut right_peer = PeerSync::new(ActorId::from("actor:left")).expect("right peer");
        let left_message = left
            .next_sync_message(&mut left_peer)
            .expect("left message")
            .expect("left message");
        let right_message = right
            .next_sync_message(&mut right_peer)
            .expect("right message")
            .expect("right message");

        let first = left
            .receive_sync_message(&mut left_peer, &right_message)
            .expect("right message first");
        assert_eq!(first.disposition, SyncDisposition::Applied);
        let duplicate = left
            .receive_sync_message(&mut left_peer, &right_message)
            .expect("duplicate right message");
        assert_eq!(duplicate.disposition, SyncDisposition::Duplicate);
        let first = right
            .receive_sync_message(&mut right_peer, &left_message)
            .expect("left message second");
        assert_eq!(first.disposition, SyncDisposition::Applied);
        let duplicate = right
            .receive_sync_message(&mut right_peer, &left_message)
            .expect("duplicate left message");
        assert_eq!(duplicate.disposition, SyncDisposition::Duplicate);

        exchange_until_idle(&mut left, &mut left_peer, &mut right, &mut right_peer);
        assert_eq!(
            left.snapshot().expect("left snapshot"),
            right.snapshot().expect("right snapshot")
        );
    }

    #[test]
    fn delayed_dependency_is_queued_until_its_parent_arrives() {
        let document_id = DocumentId::from("document:sync-delayed");
        let mut source = automerge::AutoCommit::new();
        source.put(automerge::ROOT, "value", "parent").expect("parent change");
        source.commit();
        source.put(automerge::ROOT, "value", "child").expect("child change");
        source.commit();
        let changes = source.get_changes(&[]);
        assert_eq!(changes.len(), 2);
        let parent = changes[0].clone();
        let child = changes[1].clone();
        assert!(child.deps().contains(&parent.hash()));
        let parent_payload = automerge::sync::Message {
            heads: vec![parent.hash()],
            need: Vec::new(),
            have: Vec::new(),
            changes: vec![parent.raw_bytes().to_vec()].into(),
            flags: None,
            version: automerge::sync::MessageVersion::V1,
        }
        .encode();
        let child_payload = automerge::sync::Message {
            heads: vec![child.hash()],
            need: vec![parent.hash()],
            have: Vec::new(),
            changes: vec![child.raw_bytes().to_vec()].into(),
            flags: None,
            version: automerge::sync::MessageVersion::V1,
        }
        .encode();

        let mut document = AutomergeDocument::create(
            document_id.clone(),
            ActorId::from("actor:left"),
            blank_document(&document_id, None),
        )
        .expect("document");
        let mut peer = PeerSync::new(ActorId::from("actor:right")).expect("peer");
        let delayed = SyncMessage {
            protocol_id: SYNC_PROTOCOL_ID.into(),
            version: SYNC_PROTOCOL_VERSION,
            document_id,
            sender: ActorId::from("actor:right"),
            recipient: ActorId::from("actor:left"),
            sequence: 2,
            payload: child_payload,
        };
        let parent = SyncMessage { sequence: 1, payload: parent_payload, ..delayed.clone() };

        let deferred = peer.receive_message(&mut document, &delayed).expect("defer child");
        assert_eq!(deferred.disposition, SyncDisposition::Deferred);
        assert_eq!(deferred.applied_messages, 0);
        assert_eq!(peer.status().pending_messages, 1);
        let applied = peer
            .receive_message(&mut document, &parent)
            .expect("apply parent and child");
        assert_eq!(applied.disposition, SyncDisposition::Applied);
        assert_eq!(applied.applied_messages, 2);
        assert_eq!(peer.status().pending_messages, 0);
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(8))]

        #[test]
        fn concurrent_peer_edits_converge_for_generated_names(
            left_name in "[a-z]{1,16}",
            right_name in "[a-z]{1,16}",
        ) {
            let document_id = DocumentId::from("document:sync-property");
            let mut left = TransactionEngine::create(
                document_id.clone(),
                ActorId::from("actor:left"),
                blank_document(&document_id, None),
            ).expect("left");
            let mut right = TransactionEngine::load(
                &left.save().expect("save"),
                ActorId::from("actor:right"),
            ).expect("right");
            rename(&mut left, ActorId::from("actor:left"), &left_name);
            rename(&mut right, ActorId::from("actor:right"), &right_name);
            let mut left_peer = PeerSync::new(ActorId::from("actor:right")).expect("left peer");
            let mut right_peer = PeerSync::new(ActorId::from("actor:left")).expect("right peer");

            exchange_until_idle(&mut left, &mut left_peer, &mut right, &mut right_peer);

            prop_assert_eq!(left.snapshot().expect("left snapshot"), right.snapshot().expect("right snapshot"));
            prop_assert_eq!(left_peer.status().pending_messages, 0);
            prop_assert_eq!(right_peer.status().pending_messages, 0);
        }
    }
}
