import type {
  CosmosClientOptions,
  OperationInput,
  PartitionKey,
} from "@azure/cosmos";

import type { CosmosQueryBuilder } from "./cosmos-query-builder";

export interface CosmosModuleOptions {
  endpoint: string;
  key: string;
  database: string;
  clientOptions?: Omit<CosmosClientOptions, "endpoint" | "key">;
}

export type CosmosModelClass<TInstance extends object = object> = abstract new (
  ...args: unknown[]
) => TInstance;

export type CosmosModelConstructor<TInstance extends object = object> = new (
  ...args: unknown[]
) => TInstance;

export type CosmosModelTarget<TInstance extends object = object> =
  | CosmosModelClass<TInstance>
  | CosmosModelConstructor<TInstance>
  | TInstance;

export type CosmosModelFactory<TInstance extends object = object> =
  () => CosmosModelConstructor<TInstance>;

export type CosmosRelationType = "has-many" | "belongs-to";

export interface CosmosModelOptions {
  containerName: string;
}

export interface CosmosRelationMetadata<TInstance extends object = object> {
  propertyKey: string;
  type: CosmosRelationType;
  target: CosmosModelFactory<TInstance>;
  foreignKey: string;
}

export interface CosmosModelMetadata {
  containerName: string;
  partitionKey?: string;
  relations: CosmosRelationMetadata[];
}

export interface CosmosModelInstance {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
}

export interface CosmosModelRepository<
  TModel extends CosmosModelInstance = CosmosModelInstance,
> {
  save(model: TModel): Promise<TModel>;
  patch(model: TModel, data: Partial<TModel>): Promise<TModel>;
  update(model: TModel, data: Partial<TModel>): Promise<TModel>;
  delete(model: TModel): Promise<void>;
  query(model?: TModel): CosmosQueryBuilder<TModel>;
  loadRelation<TRelation = unknown>(
    model: TModel,
    relationName: string,
  ): Promise<TRelation>;
}

export type CosmosQueryOperator = "=" | "!=" | ">" | ">=" | "<" | "<=";

export type CosmosOrderDirection = "ASC" | "DESC";

export interface CosmosQueryParameter {
  name: string;
  value: unknown;
}

export interface CosmosQueryDefinition {
  query: string;
  parameters: CosmosQueryParameter[];
}

export interface CosmosPaginatedResult<T> {
  data: T[];
  nextToken?: string;
}

export interface CosmosRelationLoadResult<TRelation = unknown> {
  relation: CosmosRelationMetadata;
  value: TRelation;
}

export interface CosmosRepositoryHooks<
  TModel extends CosmosModelInstance = CosmosModelInstance,
> {
  beforeCreate?(model: TModel): Promise<void> | void;
  afterCreate?(model: TModel): Promise<void> | void;
  beforeUpdate?(model: TModel): Promise<void> | void;
  afterUpdate?(model: TModel): Promise<void> | void;
}

export interface CosmosRepositoryConfig<
  TModel extends CosmosModelInstance = CosmosModelInstance,
> {
  hooks?: CosmosRepositoryHooks<TModel>;
  softDelete?: boolean;
  timestamps?: boolean;
  logging?: boolean;
}

export interface CosmosTransactionContext<
  TModel extends CosmosModelInstance = CosmosModelInstance,
> {
  create(data: Partial<TModel>): Promise<TModel>;
  patch(id: string, data: Partial<TModel>): Promise<TModel>;
  update(id: string, data: Partial<TModel>): Promise<TModel>;
  delete(id: string): Promise<void>;
}

export type CosmosTransactionOperationType = "create" | "replace" | "delete";

export interface CosmosTransactionOperation<
  TModel extends CosmosModelInstance,
> {
  type: CosmosTransactionOperationType;
  model: TModel;
  partitionKey?: unknown;
  batchOperation: OperationInput;
}

export interface CosmosQueryExecutionOptions {
  continuationToken?: string;
}

export interface CosmosRegisteredRepository<
  TModel extends CosmosModelInstance = CosmosModelInstance,
> {
  query(model?: TModel): CosmosQueryBuilder<TModel>;
  patch(model: TModel, data: Partial<TModel>): Promise<TModel>;
  update(model: TModel, data: Partial<TModel>): Promise<TModel>;
  loadRelation<TRelation = unknown>(
    model: TModel,
    relationName: string,
  ): Promise<TRelation>;
  loadEagerRelations(
    models: readonly TModel[],
    relationNames: readonly string[],
  ): Promise<TModel[]>;
  executeQueryBuilder(builder: CosmosQueryBuilder<TModel>): Promise<TModel[]>;
  executePaginatedQuery(
    builder: CosmosQueryBuilder<TModel>,
    options?: CosmosQueryExecutionOptions,
  ): Promise<CosmosPaginatedResult<TModel>>;
  resolvePartitionKey(
    source: Partial<TModel> | TModel | string,
  ): PartitionKey | undefined;
}
