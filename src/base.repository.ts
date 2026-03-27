import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  NotImplementedException,
} from "@nestjs/common";
import {
  BulkOperationType,
  type JSONValue,
  type JSONObject,
  type OperationInput,
  type OperationResponse,
  type PartitionKey,
  type SqlQuerySpec,
} from "@azure/cosmos";

import { BaseModel, BaseModelUpdateData } from "./base.model";
import {
  CosmosPaginatedQuery,
  CosmosQueryBuilder,
} from "./cosmos-query-builder";
import { CosmosService } from "./cosmos.service";
import {
  CosmosModelConstructor,
  CosmosRepositoryConfig,
  CosmosModelMetadata,
  CosmosPaginatedResult,
  CosmosQueryDefinition,
  CosmosRelationLoadResult,
  CosmosRelationMetadata,
  CosmosTransactionContext,
  CosmosTransactionOperation,
} from "./cosmos.interfaces";
import { getModelMetadata, getRelationMetadata } from "./cosmos.metadata";

type RepositoryModelData<TModel extends BaseModel> = Partial<
  Omit<TModel, RepositoryReservedKeys>
>;

type RepositoryReservedKeys =
  | "$save"
  | "$update"
  | "$delete"
  | "$load"
  | "attachRepository";

type PersistedRecord = Record<string, unknown>;

@Injectable()
export abstract class BaseRepository<TModel extends BaseModel> {
  private static readonly repositoryRegistry = new Map<
    Function,
    BaseRepository<BaseModel>
  >();

  protected readonly logger = new Logger(this.constructor.name);
  private readonly modelMetadata: CosmosModelMetadata;
  private readonly repositoryConfig: Required<
    Omit<CosmosRepositoryConfig<TModel>, "hooks">
  > & {
    hooks: NonNullable<CosmosRepositoryConfig<TModel>["hooks"]>;
  };

  protected constructor(
    protected readonly cosmosService: CosmosService,
    protected readonly modelClass: CosmosModelConstructor<TModel>,
    repositoryConfig?: CosmosRepositoryConfig<TModel>,
  ) {
    this.modelMetadata = this.getRequiredModelMetadata();
    this.repositoryConfig = this.resolveRepositoryConfig(repositoryConfig);
    BaseRepository.repositoryRegistry.set(
      this.modelClass,
      this as unknown as BaseRepository<BaseModel>,
    );
  }

  async create(data: RepositoryModelData<TModel>): Promise<TModel> {
    const model = this.createModelFromData(data);

    return this.persistModel(model, "create");
  }

  async findById(id: string): Promise<TModel | null> {
    const normalizedId = this.normalizeRequiredString(id, "id");
    const queryBuilder = this.query()
      .where(
        "id" as Extract<keyof TModel, string>,
        "=",
        normalizedId as TModel[Extract<keyof TModel, string>],
      )
      .limit(1);
    const [model] = await this.fetch(queryBuilder);

    return model ?? null;
  }

  async save(model: TModel): Promise<TModel> {
    const operation = this.isExistingModel(model) ? "update" : "create";

    return this.persistModel(model, operation);
  }

  async update(id: string, data: BaseModelUpdateData<TModel>): Promise<TModel>;
  async update(model: TModel, data: Partial<TModel>): Promise<TModel>;
  async update(
    modelOrId: string | TModel,
    data: Partial<TModel>,
  ): Promise<TModel> {
    const model =
      typeof modelOrId === "string"
        ? await this.requireModelById(modelOrId)
        : modelOrId;

    Object.assign(model, data);

    return this.persistModel(model, "update");
  }

  async delete(id: string): Promise<void>;
  async delete(model: TModel): Promise<void>;
  async delete(modelOrId: string | TModel): Promise<void> {
    const model =
      typeof modelOrId === "string"
        ? await this.requireModelById(modelOrId)
        : modelOrId;

    if (this.repositoryConfig.softDelete) {
      model.deletedAt = new Date();

      await this.persistModel(model, "update");
      return;
    }

    const partitionKeyValue = this.resolvePartitionKeyValue(
      this.prepareForPersistence(model),
    );

    try {
      await this.getContainer().item(model.id, partitionKeyValue).delete();
      this.logIfEnabled("delete", { id: model.id });
    } catch (error) {
      throw this.handleRepositoryError(error, "delete");
    }
  }

  async transaction<TResult>(
    callback: (trx: CosmosTransactionContext<TModel>) => Promise<TResult>,
  ): Promise<TResult> {
    const operations: Array<CosmosTransactionOperation<TModel>> = [];
    const transactionContext: CosmosTransactionContext<TModel> = {
      create: async (data) => {
        const model = this.createModelFromData(
          data as RepositoryModelData<TModel>,
        );
        await this.runBeforeHook("create", model);
        operations.push(this.createBatchOperationForCreate(model));

        return model;
      },
      update: async (id, data) => {
        const model = await this.requireModelById(id);
        Object.assign(model, data);

        await this.runBeforeHook("update", model);
        operations.push(this.createBatchOperationForReplace(model));

        return model;
      },
      delete: async (id) => {
        const model = await this.requireModelById(id);

        if (this.repositoryConfig.softDelete) {
          model.deletedAt = new Date();
          await this.runBeforeHook("update", model);
          operations.push(this.createBatchOperationForReplace(model));
          return;
        }

        operations.push(this.createBatchOperationForDelete(model));
      },
    };
    const result = await callback(transactionContext);

    await this.commitTransactionOperations(operations);

    return result;
  }

  query(): CosmosQueryBuilder<TModel> {
    return new CosmosQueryBuilder<TModel>();
  }

  async fetch(
    queryBuilder: CosmosPaginatedQuery<TModel>,
  ): Promise<CosmosPaginatedResult<TModel>>;
  async fetch(queryBuilder: CosmosQueryBuilder<TModel>): Promise<TModel[]>;
  async fetch(
    queryBuilder: CosmosQueryBuilder<TModel> | CosmosPaginatedQuery<TModel>,
  ): Promise<TModel[] | CosmosPaginatedResult<TModel>> {
    if (queryBuilder instanceof CosmosPaginatedQuery) {
      return this.fetchPaginated(queryBuilder);
    }

    const queryDefinition = queryBuilder.build();

    try {
      const { resources } = await this.getContainer()
        .items.query<PersistedRecord>(
          this.toSqlQuerySpec(this.applyDefaultFilters(queryDefinition)),
        )
        .fetchAll();

      this.logIfEnabled("fetch", { query: queryDefinition.query });

      return resources.map((resource) => this.hydrate(resource));
    } catch (error) {
      throw this.handleRepositoryError(error, "fetch");
    }
  }

  async loadRelation<TRelation = unknown>(
    model: TModel,
    relationName: string,
  ): Promise<TRelation> {
    const [result] = await this.loadRelations([model], relationName);

    if (!result) {
      throw new NotImplementedException(
        `Relation loading for \"${relationName}\" did not return a result on ${this.constructor.name}.`,
      );
    }

    return result.value as TRelation;
  }

  protected buildQueryDefinition(
    queryBuilder: CosmosQueryBuilder<TModel>,
  ): CosmosQueryDefinition {
    return this.applyDefaultFilters(queryBuilder.build());
  }

  protected async loadRelations<TRelation = unknown>(
    models: readonly TModel[],
    relationName: string,
  ): Promise<Array<CosmosRelationLoadResult<TRelation>>> {
    if (models.length === 0) {
      return [];
    }

    const relation = this.getRequiredRelationMetadata(relationName);
    const relatedRepository = this.getRelatedRepository(relation);

    if (relation.type === "has-many") {
      return this.loadHasManyRelation(
        models,
        relation,
        relatedRepository,
      ) as Promise<Array<CosmosRelationLoadResult<TRelation>>>;
    }

    return this.loadBelongsToRelation(
      models,
      relation,
      relatedRepository,
    ) as Promise<Array<CosmosRelationLoadResult<TRelation>>>;
  }

  protected hydrate(rawData: PersistedRecord): TModel {
    const model = new this.modelClass();
    const normalizedData = this.normalizeDates(rawData);

    Object.assign(model, normalizedData);

    return model.attachRepository(this);
  }

  protected getContainerName(): string {
    return this.modelMetadata.containerName;
  }

  private createModelFromData(data: RepositoryModelData<TModel>): TModel {
    const now = new Date();

    return this.hydrate({
      ...data,
      id: this.resolveId(data.id),
      createdAt: this.repositoryConfig.timestamps
        ? (data.createdAt ?? now)
        : data.createdAt,
      updatedAt: this.repositoryConfig.timestamps
        ? (data.updatedAt ?? now)
        : data.updatedAt,
    });
  }

  private createBatchOperationForCreate(
    model: TModel,
  ): CosmosTransactionOperation<TModel> {
    const data = this.preparePersistableDocument(model, true);

    return {
      type: "create",
      model,
      partitionKey: this.resolvePartitionKeyValue(data),
      batchOperation: {
        operationType: BulkOperationType.Create,
        resourceBody: this.toJsonObject(data),
      },
    };
  }

  private createBatchOperationForReplace(
    model: TModel,
  ): CosmosTransactionOperation<TModel> {
    const data = this.preparePersistableDocument(model, true);

    return {
      type: "replace",
      model,
      partitionKey: this.resolvePartitionKeyValue(data),
      batchOperation: {
        operationType: BulkOperationType.Replace,
        id: model.id,
        resourceBody: this.toJsonObject(data),
      },
    };
  }

  private createBatchOperationForDelete(
    model: TModel,
  ): CosmosTransactionOperation<TModel> {
    const data = this.prepareForPersistence(model);

    return {
      type: "delete",
      model,
      partitionKey: this.resolvePartitionKeyValue(data),
      batchOperation: {
        operationType: BulkOperationType.Delete,
        id: model.id,
      },
    };
  }

  protected async fetchByDefinition(
    queryDefinition: CosmosQueryDefinition,
  ): Promise<TModel[]> {
    try {
      const { resources } = await this.getContainer()
        .items.query<PersistedRecord>(
          this.toSqlQuerySpec(this.applyDefaultFilters(queryDefinition)),
        )
        .fetchAll();

      return resources.map((resource) => this.hydrate(resource));
    } catch (error) {
      throw this.handleRepositoryError(error, "fetch");
    }
  }

  private async fetchPaginated(
    queryBuilder: CosmosPaginatedQuery<TModel>,
  ): Promise<CosmosPaginatedResult<TModel>> {
    try {
      const response = await this.getContainer()
        .items.query<PersistedRecord>(
          this.toSqlQuerySpec(this.applyDefaultFilters(queryBuilder.build())),
          {
            continuationToken: queryBuilder.getContinuationToken(),
            maxItemCount: queryBuilder.getMaxItemCount(),
            bufferItems: false,
          },
        )
        .fetchNext();

      this.logIfEnabled("paginate", {
        query: queryBuilder.build().query,
        continuationToken: queryBuilder.getContinuationToken(),
      });

      return {
        data: response.resources.map((resource) => this.hydrate(resource)),
        nextToken: response.continuationToken || undefined,
      };
    } catch (error) {
      throw this.handleRepositoryError(error, "paginate");
    }
  }

  private getContainer() {
    return this.cosmosService.getContainer(this.modelMetadata.containerName);
  }

  private async commitTransactionOperations(
    operations: Array<CosmosTransactionOperation<TModel>>,
  ): Promise<void> {
    if (operations.length === 0) {
      return;
    }

    const partitionKey = this.resolveTransactionPartitionKey(operations);

    if (!this.canUseBatchTransaction(operations, partitionKey)) {
      this.logger.warn(
        `Falling back to sequential transaction execution for ${this.modelClass.name} because operations span multiple partitions or lack a usable partition key.`,
      );
      return this.executeSequentialFallback(operations);
    }

    try {
      const response = await this.getContainer().items.batch(
        operations.map(({ batchOperation }) => batchOperation),
        partitionKey,
      );

      this.applyBatchResults(operations, response.result ?? []);
      await this.runAfterTransactionHooks(operations);
      this.logIfEnabled("transaction", {
        operationCount: operations.length,
        batched: true,
      });
    } catch (error) {
      throw this.handleRepositoryError(error, "transaction");
    }
  }

  private getRequiredModelMetadata(): CosmosModelMetadata {
    const metadata = getModelMetadata(this.modelClass);

    if (!metadata) {
      throw new BadRequestException(
        `${this.modelClass.name} is missing @CosmosModel metadata.`,
      );
    }

    return metadata;
  }

  private getRequiredRelationMetadata(
    relationName: string,
  ): CosmosRelationMetadata {
    const relation = getRelationMetadata(this.modelClass, relationName);

    if (!relation) {
      throw new NotFoundException(
        `Relation \"${relationName}\" is not defined on ${this.modelClass.name}.`,
      );
    }

    return relation;
  }

  private getRelatedRepository(
    relation: CosmosRelationMetadata,
  ): BaseRepository<BaseModel> {
    const relatedModel = relation.target();
    const repository = BaseRepository.repositoryRegistry.get(relatedModel);

    if (!repository) {
      throw new NotImplementedException(
        `No repository is registered for related model ${relatedModel.name}.`,
      );
    }

    return repository;
  }

  private async loadHasManyRelation(
    models: readonly TModel[],
    relation: CosmosRelationMetadata,
    relatedRepository: BaseRepository<BaseModel>,
  ): Promise<Array<CosmosRelationLoadResult<BaseModel[]>>> {
    const ownerIds = this.collectUniqueValues(models.map((model) => model.id));
    const relatedModels = ownerIds.length
      ? await relatedRepository.fetchByDefinition(
          relatedRepository.buildContainsQueryDefinition(
            relation.foreignKey,
            ownerIds,
          ),
        )
      : [];
    const groupedRelations = this.groupModelsByField(
      relatedModels,
      relation.foreignKey,
    );

    return models.map((model) => {
      const relationValue = groupedRelations.get(model.id) ?? [];

      this.assignRelationValue(model, relation.propertyKey, relationValue);

      return {
        relation,
        value: relationValue,
      };
    });
  }

  private async loadBelongsToRelation(
    models: readonly TModel[],
    relation: CosmosRelationMetadata,
    relatedRepository: BaseRepository<BaseModel>,
  ): Promise<Array<CosmosRelationLoadResult<BaseModel | null>>> {
    const foreignKeys = this.collectUniqueValues(
      models
        .map((model) => this.readFieldValue(model, relation.foreignKey))
        .filter(
          (value): value is string => typeof value === "string" && !!value,
        ),
    );
    const relatedModels = foreignKeys.length
      ? await relatedRepository.fetchByDefinition(
          relatedRepository.buildContainsQueryDefinition("id", foreignKeys),
        )
      : [];
    const relatedById = new Map(
      relatedModels.map((model) => [model.id, model]),
    );

    return models.map((model) => {
      const foreignKeyValue = this.readFieldValue(model, relation.foreignKey);
      const relationValue =
        typeof foreignKeyValue === "string"
          ? (relatedById.get(foreignKeyValue) ?? null)
          : null;

      this.assignRelationValue(model, relation.propertyKey, relationValue);

      return {
        relation,
        value: relationValue,
      };
    });
  }

  private buildContainsQueryDefinition(
    field: string,
    values: readonly string[],
  ): CosmosQueryDefinition {
    if (!field.trim()) {
      throw new BadRequestException(
        "Relation field must be a non-empty string.",
      );
    }

    return {
      query: `SELECT * FROM c WHERE ARRAY_CONTAINS(@param1, c.${field})`,
      parameters: [
        {
          name: "@param1",
          value: [...values],
        },
      ],
    };
  }

  private collectUniqueValues(values: readonly string[]): string[] {
    return [...new Set(values.filter((value) => value.trim().length > 0))];
  }

  private groupModelsByField(
    models: readonly BaseModel[],
    field: string,
  ): Map<string, BaseModel[]> {
    const groups = new Map<string, BaseModel[]>();

    for (const model of models) {
      const fieldValue = this.readFieldValue(model, field);

      if (typeof fieldValue !== "string" || !fieldValue) {
        continue;
      }

      const existingGroup = groups.get(fieldValue) ?? [];
      existingGroup.push(model);
      groups.set(fieldValue, existingGroup);
    }

    return groups;
  }

  private assignRelationValue(
    model: TModel,
    relationName: string,
    value: unknown,
  ): void {
    (model as Record<string, unknown>)[relationName] = value;
  }

  private readFieldValue(model: BaseModel, field: string): unknown {
    return (model as unknown as Record<string, unknown>)[field];
  }

  private async requireModelById(id: string): Promise<TModel> {
    const model = await this.findById(id);

    if (!model) {
      throw new NotFoundException(
        `${this.modelClass.name} with id \"${id}\" was not found.`,
      );
    }

    return model;
  }

  private preparePersistableDocument(
    model: Partial<TModel>,
    ensureTimestamps: boolean,
  ): PersistedRecord {
    const data = this.prepareForPersistence(model);

    if (!data.id) {
      data.id = this.generateId();
    }

    if (ensureTimestamps && this.repositoryConfig.timestamps) {
      const now = new Date().toISOString();
      data.updatedAt = now;
      if (!data.createdAt) {
        data.createdAt = now;
      }
    }

    this.assertPartitionKeyValue(data);

    return data;
  }

  private prepareForPersistence(model: Partial<TModel>): PersistedRecord {
    const rawRecord: PersistedRecord = {};

    for (const [key, value] of Object.entries(model)) {
      rawRecord[key] = value instanceof Date ? value.toISOString() : value;
    }

    return rawRecord;
  }

  private resolveTransactionPartitionKey(
    operations: Array<CosmosTransactionOperation<TModel>>,
  ): PartitionKey | undefined {
    const partitionKeys = operations
      .map(({ partitionKey }) => this.toPartitionKeyValue(partitionKey))
      .filter((value): value is PartitionKey => value !== undefined);

    if (partitionKeys.length !== operations.length) {
      return undefined;
    }

    const [firstPartitionKey] = partitionKeys;

    if (
      partitionKeys.some(
        (partitionKey) =>
          JSON.stringify(partitionKey) !== JSON.stringify(firstPartitionKey),
      )
    ) {
      return undefined;
    }

    return firstPartitionKey;
  }

  private canUseBatchTransaction(
    operations: Array<CosmosTransactionOperation<TModel>>,
    partitionKey: PartitionKey | undefined,
  ): boolean {
    return operations.length > 0 && partitionKey !== undefined;
  }

  private async executeSequentialFallback(
    operations: Array<CosmosTransactionOperation<TModel>>,
  ): Promise<void> {
    for (const operation of operations) {
      if (operation.type === "create") {
        const model = await this.persistModel(operation.model, "create", false);
        Object.assign(operation.model, model);
        operation.model.attachRepository(this);
        continue;
      }

      if (operation.type === "replace") {
        const model = await this.persistModel(operation.model, "update", false);
        Object.assign(operation.model, model);
        operation.model.attachRepository(this);
        continue;
      }

      await this.delete(operation.model);
    }
    this.logIfEnabled("transaction", {
      operationCount: operations.length,
      batched: false,
    });
  }

  private applyBatchResults(
    operations: Array<CosmosTransactionOperation<TModel>>,
    responses: OperationResponse[],
  ): void {
    responses.forEach((response, index) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new InternalServerErrorException(
          `Transaction batch failed for ${this.modelClass.name} with status ${response.statusCode}.`,
        );
      }

      const operation = operations[index];
      if (!operation || !response.resourceBody) {
        return;
      }

      const hydrated = this.hydrate(response.resourceBody as PersistedRecord);
      Object.assign(operation.model, hydrated);
      operation.model.attachRepository(this);
    });
  }

  private async persistModel(
    model: TModel,
    operation: "create" | "update",
    runBeforeHook = true,
  ): Promise<TModel> {
    try {
      if (runBeforeHook) {
        await this.runBeforeHook(operation, model);
      }

      const data = this.preparePersistableDocument(model, true);
      const { resource } = await this.getContainer().items.upsert(data);

      if (!resource) {
        throw new InternalServerErrorException(
          `${this.modelClass.name} upsert did not return a resource.`,
        );
      }

      const hydrated = this.hydrate(resource as PersistedRecord);

      await this.runAfterHook(operation, hydrated);
      this.logIfEnabled(operation, { id: hydrated.id });

      return hydrated;
    } catch (error) {
      throw this.handleRepositoryError(error, operation);
    }
  }

  private resolvePartitionKeyValue(
    data: PersistedRecord,
  ): PartitionKey | undefined {
    const partitionKeyField = this.modelMetadata.partitionKey;

    if (!partitionKeyField) {
      return undefined;
    }

    return this.toPartitionKeyValue(data[partitionKeyField]);
  }

  private assertPartitionKeyValue(data: PersistedRecord): void {
    const partitionKeyField = this.modelMetadata.partitionKey;

    if (!partitionKeyField) {
      return;
    }

    const partitionKeyValue = this.resolvePartitionKeyValue(data);

    if (partitionKeyValue === undefined || partitionKeyValue === null) {
      throw new BadRequestException(
        `${this.modelClass.name} requires partition key field \"${partitionKeyField}\".`,
      );
    }
  }

  private normalizeDates(data: PersistedRecord): PersistedRecord {
    return {
      ...data,
      createdAt: this.parseDateValue(data.createdAt),
      updatedAt: this.parseDateValue(data.updatedAt),
      deletedAt: this.parseDateValue(data.deletedAt),
    };
  }

  private resolveRepositoryConfig(
    repositoryConfig?: CosmosRepositoryConfig<TModel>,
  ) {
    return {
      softDelete: repositoryConfig?.softDelete ?? false,
      timestamps: repositoryConfig?.timestamps ?? true,
      logging: repositoryConfig?.logging ?? false,
      hooks: repositoryConfig?.hooks ?? {},
    };
  }

  private applyDefaultFilters(
    queryDefinition: CosmosQueryDefinition,
  ): CosmosQueryDefinition {
    if (!this.repositoryConfig.softDelete) {
      return queryDefinition;
    }

    const deletedFilter =
      "(NOT IS_DEFINED(c.deletedAt) OR IS_NULL(c.deletedAt))";
    const hasWhere = /\bWHERE\b/i.test(queryDefinition.query);

    return {
      query: hasWhere
        ? `${queryDefinition.query} AND ${deletedFilter}`
        : `${queryDefinition.query} WHERE ${deletedFilter}`,
      parameters: [...queryDefinition.parameters],
    };
  }

  private isExistingModel(model: TModel): boolean {
    return Boolean(model.createdAt || model.updatedAt || model.deletedAt);
  }

  private async runBeforeHook(
    operation: "create" | "update",
    model: TModel,
  ): Promise<void> {
    if (operation === "create") {
      await this.repositoryConfig.hooks.beforeCreate?.(model);
      return;
    }

    await this.repositoryConfig.hooks.beforeUpdate?.(model);
  }

  private async runAfterHook(
    operation: "create" | "update",
    model: TModel,
  ): Promise<void> {
    if (operation === "create") {
      await this.repositoryConfig.hooks.afterCreate?.(model);
      return;
    }

    await this.repositoryConfig.hooks.afterUpdate?.(model);
  }

  private async runAfterTransactionHooks(
    operations: Array<CosmosTransactionOperation<TModel>>,
  ): Promise<void> {
    for (const operation of operations) {
      if (operation.type === "create") {
        await this.runAfterHook("create", operation.model);
        continue;
      }

      if (operation.type === "replace") {
        await this.runAfterHook("update", operation.model);
      }
    }
  }

  private logIfEnabled(
    operation: string,
    context?: Record<string, unknown>,
  ): void {
    if (!this.repositoryConfig.logging) {
      return;
    }

    this.logger.log(
      `${this.modelClass.name} ${operation}${context ? ` ${JSON.stringify(context)}` : ""}`,
    );
  }

  private parseDateValue(value: unknown): Date | undefined {
    if (value === undefined || value === null || value instanceof Date) {
      return value as Date | undefined;
    }

    if (typeof value !== "string") {
      return undefined;
    }

    const parsedDate = new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
      return undefined;
    }

    return parsedDate;
  }

  private resolveId(id: unknown): string {
    if (typeof id === "string" && id.trim()) {
      return id.trim();
    }

    return this.generateId();
  }

  private generateId(): string {
    return (
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
    );
  }

  private toPartitionKeyValue(value: unknown): PartitionKey | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (value instanceof Date) {
      return value.toISOString() as PartitionKey;
    }

    return value as PartitionKey;
  }

  private toSqlQuerySpec(queryDefinition: CosmosQueryDefinition): SqlQuerySpec {
    return {
      query: queryDefinition.query,
      parameters: queryDefinition.parameters.map(({ name, value }) => ({
        name,
        value: this.toJsonValue(value),
      })),
    };
  }

  private toJsonValue(value: unknown): JSONValue {
    if (value === undefined) {
      return null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return value as JSONValue;
  }

  private toJsonObject(record: PersistedRecord): JSONObject {
    const jsonObject: JSONObject = {};

    for (const [key, value] of Object.entries(record)) {
      jsonObject[key] = this.toJsonValue(value);
    }

    return jsonObject;
  }

  private normalizeRequiredString(value: string, fieldName: string): string {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException(`${fieldName} must be a non-empty string.`);
    }

    return normalizedValue;
  }

  private handleRepositoryError(error: unknown, operation: string): Error {
    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException ||
      error instanceof NotImplementedException ||
      error instanceof InternalServerErrorException
    ) {
      return error;
    }

    const message =
      error instanceof Error ? error.message : "Unknown repository failure.";

    this.logger.error(
      `Failed to ${operation} ${this.modelClass.name}: ${message}`,
    );

    return new InternalServerErrorException(
      `Failed to ${operation} ${this.modelClass.name}.`,
    );
  }
}
