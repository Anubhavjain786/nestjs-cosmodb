import type { BaseModel } from "./base.model";
import type {
  CosmosModelConstructor,
  CosmosRegisteredRepository,
} from "./cosmos.interfaces";

const repositoryRegistry = new Map<
  Function,
  CosmosRegisteredRepository<BaseModel>
>();

export function registerRepository<TModel extends BaseModel>(
  modelClass: CosmosModelConstructor<TModel>,
  repository: CosmosRegisteredRepository<TModel>,
): void {
  repositoryRegistry.set(
    modelClass,
    repository as unknown as CosmosRegisteredRepository<BaseModel>,
  );
}

export function getRegisteredRepository<TModel extends BaseModel>(
  modelClass: CosmosModelConstructor<TModel>,
): CosmosRegisteredRepository<TModel> | undefined {
  return repositoryRegistry.get(modelClass) as
    | CosmosRegisteredRepository<TModel>
    | undefined;
}
