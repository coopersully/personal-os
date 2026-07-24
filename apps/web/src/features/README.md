# Web feature modules

Feature modules own their page composition, query hooks, local view state, and
feature-only components. They compose the generated shadcn primitives in
`src/components/ui`; they do not create replacement primitives.

The app shell owns routes, global navigation, the generic Add menu, modal
composition, and Today. A vertical feature can add a module here without editing
the shell; the Integration owner wires it into routing after the feature has a
verified public contract.

See [`docs/engineering/feature-ownership.md`](../../../../docs/engineering/feature-ownership.md)
for the full ownership and merge policy.

Before changing feature UI, also read the shared
[`design system`](../../../../docs/design/system.md) and its applicable page
specification in [`docs/design/pages`](../../../../docs/design/pages). Those
documents define the block grammar, progressive-disclosure rules, and visual
verification expected of product surfaces.

Settings work also follows the shared
[`settings UI standards`](../../../../docs/engineering/settings-ui-standards.md).
