module baton_core::memory;

use sui::dynamic_field as df;
use sui::event;

const VERSION: u64 = 1;
const HASH_LENGTH: u64 = 32;
const SEAL_ID_LENGTH: u64 = 64;
const MAX_PROJECT_ID_LENGTH: u64 = 128;
const MAX_BRANCH_LENGTH: u64 = 255;
const MAX_BLOB_ID_LENGTH: u64 = 256;
const MAX_ATTACHMENT_ID_LENGTH: u64 = 128;
const MAX_ATTACHMENTS: u64 = 32;
const MAX_PARENTS: u64 = 2;
const MAX_GRADER_MODEL_LENGTH: u64 = 128;
const MAX_FIDELITY_BPS: u16 = 10_000;
const MAX_CAPTURE_MODE: u8 = 3;
const MAX_TOOL: u8 = 4;

const E_NOT_OWNER: u64 = 1;
const E_WRONG_VERSION: u64 = 2;
const E_INVALID_PROJECT_ID: u64 = 3;
const E_INVALID_HASH: u64 = 4;
const E_INVALID_BRANCH: u64 = 5;
const E_INVALID_BLOB_ID: u64 = 6;
const E_TOO_MANY_PARENTS: u64 = 7;
const E_PARENT_NOT_FOUND: u64 = 8;
const E_HEAD_NOT_PARENT: u64 = 9;
const E_MANIFEST_EXISTS: u64 = 10;
const E_INVALID_FIDELITY: u64 = 11;
const E_INVALID_CAPTURE_MODE: u64 = 12;
const E_INVALID_TOOL: u64 = 13;
const E_TOO_MANY_ATTACHMENTS: u64 = 14;
const E_INVALID_ATTACHMENT: u64 = 15;
const E_NO_BRANCH: u64 = 16;
const E_NO_MANIFEST: u64 = 17;
const E_NO_SEAL_ACCESS: u64 = 18;

public struct ProjectMemory has key {
    id: UID,
    version: u64,
    project_id: vector<u8>,
    owner: address,
    handoff_count: u64,
}

/// Non-transferable outside this module. Ownership changes must update ProjectMemory.
public struct OwnerCap has key {
    id: UID,
    project: ID,
}

public struct ManifestKey has copy, drop, store {
    hash: vector<u8>,
}

public struct BranchKey has copy, drop, store {
    name: vector<u8>,
}

public struct BranchHead has store {
    hash: vector<u8>,
}

public struct AttachmentRef has store, drop {
    id: vector<u8>,
    blob_id: vector<u8>,
    content_hash: vector<u8>,
}

public struct HandoffManifest has store {
    version: u16,
    branch: vector<u8>,
    handoff_blob_id: vector<u8>,
    parent_hashes: vector<vector<u8>>,
    fidelity_bps: Option<u16>,
    grader_model: vector<u8>,
    rubric_version: u8,
    capture_mode: u8,
    tool: u8,
    timestamp_ms: u64,
    attachments: vector<AttachmentRef>,
}

public struct ProjectCreated has copy, drop {
    project: ID,
    owner: address,
}

public struct HandoffAnchored has copy, drop {
    project: ID,
    content_hash: vector<u8>,
    branch: vector<u8>,
    handoff_count: u64,
}

public struct OwnershipTransferred has copy, drop {
    project: ID,
    previous_owner: address,
    new_owner: address,
}

public fun create_project(project_id: vector<u8>, ctx: &mut TxContext) {
    assert!(!project_id.is_empty() && project_id.length() <= MAX_PROJECT_ID_LENGTH, E_INVALID_PROJECT_ID);
    let owner = ctx.sender();
    let project = ProjectMemory {
        id: object::new(ctx),
        version: VERSION,
        project_id,
        owner,
        handoff_count: 0,
    };
    let project_object_id = object::id(&project);
    let cap = OwnerCap { id: object::new(ctx), project: project_object_id };
    event::emit(ProjectCreated { project: project_object_id, owner });
    transfer::share_object(project);
    transfer::transfer(cap, owner);
}

public fun transfer_ownership(
    project: &mut ProjectMemory,
    cap: OwnerCap,
    new_owner: address,
) {
    assert_owner(project, &cap);
    let previous_owner = project.owner;
    project.owner = new_owner;
    event::emit(OwnershipTransferred {
        project: object::id(project),
        previous_owner,
        new_owner,
    });
    transfer::transfer(cap, new_owner);
}

public fun anchor_handoff(
    project: &mut ProjectMemory,
    cap: &OwnerCap,
    content_hash: vector<u8>,
    branch: vector<u8>,
    handoff_blob_id: vector<u8>,
    parent_hashes: vector<vector<u8>>,
    has_fidelity: bool,
    fidelity_bps: u16,
    grader_model: vector<u8>,
    rubric_version: u8,
    capture_mode: u8,
    tool: u8,
    timestamp_ms: u64,
    attachment_ids: vector<vector<u8>>,
    attachment_blob_ids: vector<vector<u8>>,
    attachment_hashes: vector<vector<u8>>,
) {
    assert_owner(project, cap);
    assert!(content_hash.length() == HASH_LENGTH, E_INVALID_HASH);
    assert!(!branch.is_empty() && branch.length() <= MAX_BRANCH_LENGTH, E_INVALID_BRANCH);
    assert!(!handoff_blob_id.is_empty() && handoff_blob_id.length() <= MAX_BLOB_ID_LENGTH, E_INVALID_BLOB_ID);
    assert!(parent_hashes.length() <= MAX_PARENTS, E_TOO_MANY_PARENTS);
    assert!(!has_fidelity || fidelity_bps <= MAX_FIDELITY_BPS, E_INVALID_FIDELITY);
    assert!(grader_model.length() <= MAX_GRADER_MODEL_LENGTH, E_INVALID_FIDELITY);
    assert!(capture_mode <= MAX_CAPTURE_MODE, E_INVALID_CAPTURE_MODE);
    assert!(tool <= MAX_TOOL, E_INVALID_TOOL);
    let attachments = build_attachments(attachment_ids, attachment_blob_ids, attachment_hashes);

    let manifest_key = ManifestKey { hash: content_hash };
    assert!(!df::exists(&project.id, manifest_key), E_MANIFEST_EXISTS);
    validate_parents(project, &parent_hashes);

    let branch_key = BranchKey { name: branch };
    if (df::exists(&project.id, branch_key)) {
        let current_head = &df::borrow<BranchKey, BranchHead>(&project.id, branch_key).hash;
        assert!(contains_hash(&parent_hashes, current_head), E_HEAD_NOT_PARENT);
    };

    let fidelity = if (has_fidelity) option::some(fidelity_bps) else option::none();
    let manifest = HandoffManifest {
        version: 1,
        branch,
        handoff_blob_id,
        parent_hashes,
        fidelity_bps: fidelity,
        grader_model,
        rubric_version,
        capture_mode,
        tool,
        timestamp_ms,
        attachments,
    };
    df::add(&mut project.id, manifest_key, manifest);

    if (df::exists(&project.id, branch_key)) {
        df::borrow_mut<BranchKey, BranchHead>(&mut project.id, branch_key).hash = content_hash;
    } else {
        df::add(&mut project.id, branch_key, BranchHead { hash: content_hash });
    };

    project.handoff_count = project.handoff_count + 1;
    event::emit(HandoffAnchored {
        project: object::id(project),
        content_hash,
        branch,
        handoff_count: project.handoff_count,
    });
}

fun validate_parents(project: &ProjectMemory, parents: &vector<vector<u8>>) {
    let mut i = 0;
    while (i < parents.length()) {
        let parent = &parents[i];
        assert!(parent.length() == HASH_LENGTH, E_INVALID_HASH);
        assert!(df::exists(&project.id, ManifestKey { hash: *parent }), E_PARENT_NOT_FOUND);
        i = i + 1;
    };
}

fun build_attachments(
    ids: vector<vector<u8>>,
    blob_ids: vector<vector<u8>>,
    hashes: vector<vector<u8>>,
): vector<AttachmentRef> {
    assert!(ids.length() == blob_ids.length() && ids.length() == hashes.length(), E_INVALID_ATTACHMENT);
    assert!(ids.length() <= MAX_ATTACHMENTS, E_TOO_MANY_ATTACHMENTS);
    let mut attachments = vector[];
    let mut i = 0;
    while (i < ids.length()) {
        let id = ids[i];
        let blob_id = blob_ids[i];
        let content_hash = hashes[i];
        assert!(
            !id.is_empty() && id.length() <= MAX_ATTACHMENT_ID_LENGTH &&
            !blob_id.is_empty() && blob_id.length() <= MAX_BLOB_ID_LENGTH &&
            content_hash.length() == HASH_LENGTH,
            E_INVALID_ATTACHMENT,
        );
        attachments.push_back(AttachmentRef { id, blob_id, content_hash });
        i = i + 1;
    };
    attachments
}

fun contains_hash(hashes: &vector<vector<u8>>, target: &vector<u8>): bool {
    let mut i = 0;
    while (i < hashes.length()) {
        if (&hashes[i] == target) return true;
        i = i + 1;
    };
    false
}

fun assert_owner(project: &ProjectMemory, cap: &OwnerCap) {
    assert!(project.version == VERSION, E_WRONG_VERSION);
    assert!(cap.project == object::id(project), E_NOT_OWNER);
}

/// Seal identity format: [32-byte ProjectMemory ID][32-byte baton content hash].
fun check_seal_policy(id: &vector<u8>, project: &ProjectMemory, cap: &OwnerCap): bool {
    if (project.version != VERSION || cap.project != object::id(project) || id.length() != SEAL_ID_LENGTH) {
        return false
    };
    let project_bytes = object::id(project).to_bytes();
    let mut content_hash = vector[];
    let mut i = 0;
    while (i < HASH_LENGTH) {
        if (id[i] != project_bytes[i]) return false;
        content_hash.push_back(id[i + HASH_LENGTH]);
        i = i + 1;
    };
    df::exists(&project.id, ManifestKey { hash: content_hash })
}

/// Evaluated by Seal key servers. Owned OwnerCap input proves current ownership.
entry fun seal_approve(id: vector<u8>, project: &ProjectMemory, cap: &OwnerCap) {
    assert!(check_seal_policy(&id, project, cap), E_NO_SEAL_ACCESS);
}

public fun version(project: &ProjectMemory): u64 { project.version }
public fun project_id(project: &ProjectMemory): &vector<u8> { &project.project_id }
public fun owner(project: &ProjectMemory): address { project.owner }
public fun handoff_count(project: &ProjectMemory): u64 { project.handoff_count }

public fun has_manifest(project: &ProjectMemory, content_hash: vector<u8>): bool {
    df::exists(&project.id, ManifestKey { hash: content_hash })
}

public fun branch_head(project: &ProjectMemory, branch: vector<u8>): vector<u8> {
    let key = BranchKey { name: branch };
    assert!(df::exists(&project.id, key), E_NO_BRANCH);
    df::borrow<BranchKey, BranchHead>(&project.id, key).hash
}

public fun handoff_blob_id(project: &ProjectMemory, content_hash: vector<u8>): &vector<u8> {
    let key = ManifestKey { hash: content_hash };
    assert!(df::exists(&project.id, key), E_NO_MANIFEST);
    &df::borrow<ManifestKey, HandoffManifest>(&project.id, key).handoff_blob_id
}

public fun new_attachment_ref(
    id: vector<u8>,
    blob_id: vector<u8>,
    content_hash: vector<u8>,
): AttachmentRef {
    AttachmentRef { id, blob_id, content_hash }
}
