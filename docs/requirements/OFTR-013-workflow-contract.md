# OFTR-013: Workflow Contract

## Overview

Outfitter resolves, validates, lists, and exports declarative workflow resources without executing
them. This contract defines the workflow resource and its typed output declarations for
[#377](https://github.com/ai-outfitter/outfitter/issues/377).

## Requirements

### OFTR-013.1: Workflow Resource Shape

1. A workflow resource MUST declare `version: 1`, and its `id` MUST match the directory slug that
   contains its `workflow.yaml` file.
2. Every node MUST declare exactly one of `action` or `workflow`.
3. Every node `needs` reference MUST name another node in the same workflow.
4. Every nested `workflow` reference MUST resolve by workflow slug.
5. Nested workflow references MUST NOT form a cycle.
6. An output-type resource MUST be a top-level catalog resource at
   `output-types/<slug>/schema.json` and MUST be subject to catalog layer precedence.

### OFTR-013.2: Output Declarations

1. A workflow MAY declare an `outputs` object whose property names MUST start with a lowercase letter
   and otherwise follow the workflow node ID pattern.
2. Every output entry MUST take exactly one of two shapes: `{ from, type }` or `{ from, output }`.
   An output entry MUST NOT carry any other property.
3. An output entry's `from` value MUST name a node in the declaring workflow.
4. An output entry with `type` MUST name an action node. An output entry with `output` MUST name a
   nested-workflow node.
5. An output entry with `output` MUST name an output declared by the referenced nested workflow.
6. An action output's resolved type MUST be its declared `type`. A mapped output's resolved type MUST
   be the resolved type of the named nested workflow output, resolved through every mapping level.
7. Existing workflows without an `outputs` object MUST remain valid.

### OFTR-013.3: Output Value Types

Amendment (2026-09-07): Output types are resolved as catalog resources instead of a closed
Outfitter-owned vocabulary.

1. REQUIREMENT REMOVED (2026-09-07): This statement required the closed `pull-request`,
   `git-commit`, `git-branch`, and `issue` vocabulary; it was withdrawn because types are catalog
   resources identified by canonical `$id` and digest.
2. REQUIREMENT REMOVED (2026-09-07): This statement required Outfitter to publish one schema per
   supported type; it was withdrawn because Outfitter no longer publishes output-type schemas;
   catalogs do, and layer precedence selects the winner.
3. Catalog authors SHOULD describe the forge-neutral field subset shared by the GitHub and Forgejo
   REST representations of a resource, and execution engines MAY carry additional fields.
4. An output `type` MUST name an output-type resource resolvable from the effective catalog layers.
5. An output-type resource MUST provide a valid JSON Schema describing the recorded value.
6. A workflow whose output `type` does not resolve MUST be rejected.

Amendment (2026-09-07): Output-type identity is bound to a canonical schema URI and its exact
schema bytes.

7. An output-type schema MUST declare a canonical `$id` that is an absolute URI.
8. The identity of an output type MUST be the pair of its canonical `$id` and the SHA-256 digest of
   its schema file bytes exactly as stored.

Amendment (2026-09-07): Schema defects are attributed to their output-type resource rather than to
each workflow reference.

9. An output-type schema defect MUST be reported once per output-type resource regardless of how
   many workflows reference it.

Amendment (2026-09-07): Output-type schemas are self-contained because catalog schema resolution
does not link separate output-type resources.

10. An output-type schema MUST be self-contained; `$ref` values MAY only target definitions within
    that schema.

### OFTR-013.4: Export and Listing

1. Machine-readable workflow listings MUST include each workflow's resolved `outputs`, ordered by
   output name, with every entry carrying its resolved type.
2. The workflow composition manifest MUST include the same resolved `outputs` for every workflow
   in the closure.
3. Repeated exports of the same resolved workflow MUST produce byte-identical files.
4. Exported `workflow.yaml` files MUST remain verbatim copies of their source documents.
5. A workflow export MUST include the resolved schema of every output type used in the closure and
   MUST record its winning source.

Amendment (2026-09-07): Exports carry the canonical identity of every used output type.

6. A workflow export MUST record the canonical `$id` and SHA-256 digest of every output type used in
   the closure, and every resolved output entry MUST record that canonical `$id` as `schema`.

Amendment (2026-09-07): Machine-readable listings expose output-type provenance, and workflow
exports enforce catalog-tree containment for output-type schemas.

7. Outfitter MUST list output-type resources machine-readably with their winning source.
8. A workflow export MUST NOT include an output-type schema that resolves outside the catalog tree.

### OFTR-013.5: Execution Boundary

1. Outfitter MUST NOT execute workflows and MUST NOT record concrete output values.
2. An execution engine, not Outfitter, MUST record concrete output values.
3. Node `needs` references MUST express only intra-workflow ordering. Cross-task dependencies MUST
   be evaluated by an execution engine against declared workflow outputs.
4. A runtime carrying a workflow output value over A2A SHOULD use the `outfitter-task/v1` artifact
   metadata keys `output` for the declared output name, `type` for its resolved output type, and
   `value` for the concrete value validated against that type's schema.

Amendment (2026-09-07): Consumers identify output values by schema identity instead of catalog
slug.

5. A consumer SHOULD compare output values by the pair of the canonical schema `$id` and its
   SHA-256 digest and MUST NOT rely on the output-type slug alone.
6. A runtime carrying a workflow output value over A2A SHOULD also carry `schema`, containing the
   canonical `$id`, and `digest`, containing the schema's SHA-256 digest.
