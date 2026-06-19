#[test_only]
module baton_core::memory_tests;

use baton_core::memory::{Self, OwnerCap, ProjectMemory};
use sui::test_scenario;

const OWNER: address = @0xA11CE;
const NEXT_OWNER: address = @0xB0B;

fun hash(byte: u8): vector<u8> {
    let mut value = vector[];
    let mut i = 0u64;
    while (i < 32) {
        value.push_back(byte);
        i = i + 1;
    };
    value
}

fun create(scenario: &mut test_scenario::Scenario): (ProjectMemory, OwnerCap) {
    memory::create_project(b"project-1", scenario.ctx());
    scenario.next_tx(OWNER);
    (scenario.take_shared<ProjectMemory>(), scenario.take_from_sender<OwnerCap>())
}

fun anchor(
    project: &mut ProjectMemory,
    cap: &OwnerCap,
    content_hash: vector<u8>,
    branch: vector<u8>,
    parents: vector<vector<u8>>,
) {
    memory::anchor_handoff(
        project,
        cap,
        content_hash,
        branch,
        b"walrus-handoff",
        parents,
        true,
        9_300,
        b"grader-v1",
        1,
        0,
        0,
        1_750_000_000_000,
        vector[b"transcript-1"],
        vector[b"walrus-transcript"],
        vector[hash(99)],
    );
}

#[test]
fun create_and_anchor_manifest() {
    let mut scenario = test_scenario::begin(OWNER);
    let (mut project, cap) = create(&mut scenario);
    assert!(memory::version(&project) == 1);
    assert!(memory::project_id(&project) == b"project-1");
    assert!(memory::owner(&project) == OWNER);
    assert!(memory::handoff_count(&project) == 0);

    let h1 = hash(1);
    anchor(&mut project, &cap, h1, b"main", vector[]);
    assert!(memory::has_manifest(&project, h1));
    assert!(memory::handoff_count(&project) == 1);
    assert!(memory::branch_head(&project, b"main") == h1);
    assert!(memory::handoff_blob_id(&project, h1) == b"walrus-handoff");

    test_scenario::return_shared(project);
    scenario.return_to_sender(cap);
    scenario.end();
}

#[test]
fun branch_lineage_and_merge() {
    let mut scenario = test_scenario::begin(OWNER);
    let (mut project, cap) = create(&mut scenario);
    let h1 = hash(1);
    let h2 = hash(2);
    let h3 = hash(3);
    let h4 = hash(4);

    anchor(&mut project, &cap, h1, b"main", vector[]);
    anchor(&mut project, &cap, h2, b"main", vector[h1]);
    anchor(&mut project, &cap, h3, b"feature", vector[h1]);
    anchor(&mut project, &cap, h4, b"main", vector[h2, h3]);

    assert!(memory::branch_head(&project, b"main") == h4);
    assert!(memory::branch_head(&project, b"feature") == h3);
    assert!(memory::handoff_count(&project) == 4);

    test_scenario::return_shared(project);
    scenario.return_to_sender(cap);
    scenario.end();
}

#[test]
fun seal_policy_binds_project_owner_and_manifest() {
    let mut scenario = test_scenario::begin(OWNER);
    let (mut project, cap) = create(&mut scenario);
    let h1 = hash(1);
    anchor(&mut project, &cap, h1, b"main", vector[]);

    let mut identity = object::id(&project).to_bytes();
    identity.append(h1);
    assert!(memory::check_seal_policy_for_testing(&identity, &project, &cap));

    let mut unknown_identity = object::id(&project).to_bytes();
    unknown_identity.append(hash(9));
    assert!(!memory::check_seal_policy_for_testing(&unknown_identity, &project, &cap));
    assert!(!memory::check_seal_policy_for_testing(&hash(1), &project, &cap));

    test_scenario::return_shared(project);
    scenario.return_to_sender(cap);
    scenario.end();
}

#[test]
fun ownership_transfer_moves_authority() {
    let mut scenario = test_scenario::begin(OWNER);
    let (mut project, cap) = create(&mut scenario);
    memory::transfer_ownership(&mut project, cap, NEXT_OWNER);
    assert!(memory::owner(&project) == NEXT_OWNER);
    test_scenario::return_shared(project);

    scenario.next_tx(NEXT_OWNER);
    let cap = scenario.take_from_sender<OwnerCap>();
    let project = scenario.take_shared<ProjectMemory>();
    assert!(memory::owner(&project) == NEXT_OWNER);
    test_scenario::return_shared(project);
    scenario.return_to_sender(cap);
    scenario.end();
}

#[test, expected_failure(abort_code = 8, location = memory)]
fun rejects_unknown_parent() {
    let mut scenario = test_scenario::begin(OWNER);
    let (mut project, cap) = create(&mut scenario);
    anchor(&mut project, &cap, hash(2), b"main", vector[hash(1)]);
    abort 0
}

#[test, expected_failure(abort_code = 9, location = memory)]
fun rejects_branch_update_without_current_head() {
    let mut scenario = test_scenario::begin(OWNER);
    let (mut project, cap) = create(&mut scenario);
    let h1 = hash(1);
    anchor(&mut project, &cap, h1, b"main", vector[]);
    anchor(&mut project, &cap, hash(2), b"main", vector[]);
    abort 0
}

#[test, expected_failure(abort_code = 10, location = memory)]
fun rejects_duplicate_manifest() {
    let mut scenario = test_scenario::begin(OWNER);
    let (mut project, cap) = create(&mut scenario);
    let h1 = hash(1);
    anchor(&mut project, &cap, h1, b"main", vector[]);
    anchor(&mut project, &cap, h1, b"feature", vector[h1]);
    abort 0
}

#[test, expected_failure(abort_code = 1, location = memory)]
fun rejects_cap_from_another_project() {
    let mut scenario = test_scenario::begin(OWNER);
    memory::create_project(b"project-1", scenario.ctx());
    scenario.next_tx(OWNER);
    let project1 = scenario.take_shared<ProjectMemory>();
    let project1_id = object::id(&project1);
    test_scenario::return_shared(project1);

    memory::create_project(b"project-2", scenario.ctx());
    scenario.next_tx(OWNER);
    let wrong_cap = scenario.take_from_sender<OwnerCap>();
    let mut project1 = scenario.take_shared_by_id<ProjectMemory>(project1_id);
    anchor(&mut project1, &wrong_cap, hash(1), b"main", vector[]);
    abort 0
}
