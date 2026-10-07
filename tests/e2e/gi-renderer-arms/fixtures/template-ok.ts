// ADR 0096 § 4: `?template` with no `for=` at the import site. A corpus file, so the
// corpus gate keeps owning every `.blp` in the repository.
import Template from '../../../../packages/infra/blueprint/corpus/rules/01-object-minimal.blp?template';

export const template = Template;
