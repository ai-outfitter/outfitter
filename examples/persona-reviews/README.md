# Persona reviews example

A runnable version of the [persona review convention](../../docs/documentation/usecases/persona-reviews.md): one base reviewer agent plus interchangeable role documents.

| Role document                           | Reviews whether…                                                   |
| --------------------------------------- | ------------------------------------------------------------------ |
| `personas/roles/founder-operator.md`    | a hands-on founder gets obvious leverage in the first hour         |
| `personas/roles/staff-engineer.md`      | the product is credible for complex technical work                 |
| `personas/roles/engineering-manager.md` | a team can adopt it safely                                         |
| `personas/roles/platform-lead.md`       | trust boundaries and operations fit an internal developer platform |

## Run it

From this directory:

```bash
cd examples/persona-reviews
outfitter run reviewer -- --print \
  "Adopt personas/roles/staff-engineer.md. Review ../../README.md and return the standard review."
```

Swap the role path to change viewpoint without duplicating the review agent. Add concrete
individual documents when a role archetype needs a particular demographic or voice.

These personas are simulations, not customer research. Use them to find obvious blockers cheaply
before asking real prospects to spend time on a review.
