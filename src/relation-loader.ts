import type { BaseModel } from "./base.model";
import type { BaseRepository } from "./base.repository";

export class RelationLoader<TModel extends BaseModel> {
  constructor(private readonly repository: BaseRepository<TModel>) {}

  async load(
    models: readonly TModel[],
    relationNames: readonly string[],
  ): Promise<TModel[]> {
    if (models.length === 0 || relationNames.length === 0) {
      return [...models];
    }

    for (const relationName of relationNames) {
      await this.repository.batchLoadRelation(models, relationName);
    }

    return [...models];
  }
}
