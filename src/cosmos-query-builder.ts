import type {
  CosmosRegisteredRepository,
  CosmosPaginatedResult,
  CosmosModelConstructor,
  CosmosModelInstance,
} from "./cosmos.interfaces";
import {
  CosmosOrderDirection,
  CosmosQueryDefinition,
  CosmosQueryOperator,
  CosmosQueryParameter,
} from "./cosmos.interfaces";

type CosmosFieldName<TModel extends object> = Extract<keyof TModel, string>;

interface CosmosWhereClause<TModel extends object> {
  field: CosmosFieldName<TModel>;
  operator: CosmosQueryOperator;
  parameterName: string;
}

interface CosmosOrderClause<TModel extends object> {
  field: CosmosFieldName<TModel>;
  direction: CosmosOrderDirection;
}

export class CosmosPaginatedQuery<TModel extends CosmosModelInstance> {
  constructor(
    private readonly queryBuilder: CosmosQueryBuilder<TModel>,
    private readonly continuationToken?: string,
  ) {}

  build(): CosmosQueryDefinition {
    return this.queryBuilder.buildForPagination();
  }

  getContinuationToken(): string | undefined {
    return this.continuationToken;
  }

  getMaxItemCount(): number | undefined {
    return this.queryBuilder.getLimit();
  }

  getQueryBuilder(): CosmosQueryBuilder<TModel> {
    return this.queryBuilder;
  }
}

export class CosmosQueryBuilder<TModel extends CosmosModelInstance> {
  private readonly parameters: CosmosQueryParameter[] = [];
  private readonly whereClauses: CosmosWhereClause<TModel>[] = [];
  private readonly eagerRelations = new Set<string>();
  private selectedFields: CosmosFieldName<TModel>[] = [];
  private orderClause?: CosmosOrderClause<TModel>;
  private limitValue?: number;
  private parameterIndex = 0;

  constructor(
    private readonly repository?: CosmosRegisteredRepository<TModel>,
    private readonly modelClass?: CosmosModelConstructor<TModel>,
    private readonly targetModel?: TModel,
  ) {}

  where<TField extends CosmosFieldName<TModel>>(
    field: TField,
    operator: CosmosQueryOperator,
    value: TModel[TField],
  ): this {
    this.assertFieldName(field);

    return this.appendWhereClause(field, operator, value);
  }

  andWhere<TField extends CosmosFieldName<TModel>>(
    field: TField,
    operator: CosmosQueryOperator,
    value: TModel[TField],
  ): this {
    this.assertFieldName(field);

    return this.appendWhereClause(field, operator, value);
  }

  limit(n: number): this {
    if (!Number.isInteger(n) || n <= 0) {
      throw new TypeError("Limit must be a positive integer.");
    }

    this.limitValue = n;

    return this;
  }

  orderBy<TField extends CosmosFieldName<TModel>>(
    field: TField,
    direction: CosmosOrderDirection,
  ): this {
    this.assertFieldName(field);
    this.assertOrderDirection(direction);

    this.orderClause = {
      field,
      direction,
    };

    return this;
  }

  select<TField extends CosmosFieldName<TModel>>(
    fields: readonly TField[],
  ): this {
    if (fields.length === 0) {
      throw new TypeError("select() requires at least one field.");
    }

    this.selectedFields = fields.map((field) => {
      this.assertFieldName(field);
      return field;
    });

    return this;
  }

  with(relationNames: string | readonly string[]): this {
    const values = Array.isArray(relationNames)
      ? relationNames
      : [relationNames];

    for (const relationName of values) {
      const normalizedRelationName = relationName.trim();

      if (!normalizedRelationName) {
        throw new TypeError(
          "Relation names passed to with() must be non-empty.",
        );
      }

      this.eagerRelations.add(normalizedRelationName);
    }

    return this;
  }

  withGraphFetched(relationNames: string | readonly string[]): this {
    return this.with(relationNames);
  }

  async execute(): Promise<TModel[]> {
    return this.requireRepository().executeQueryBuilder(this);
  }

  async first(): Promise<TModel | null> {
    this.limit(1);

    const [model] = await this.execute();

    return model ?? null;
  }

  async findOne(): Promise<TModel | null> {
    return this.first();
  }

  async patch(data: Partial<TModel>): Promise<TModel> {
    const targetModel = this.requireTargetModel();

    return this.requireRepository().patch(targetModel, data);
  }

  async update(data: Partial<TModel>): Promise<TModel> {
    const targetModel = this.requireTargetModel();

    return this.requireRepository().update(targetModel, data);
  }

  async delete(): Promise<void> {
    const targetModel = this.requireTargetModel();

    await this.requireRepository().delete(targetModel);
  }

  toPaginatedQuery(continuationToken?: string): CosmosPaginatedQuery<TModel> {
    if (!this.limitValue) {
      throw new TypeError(
        "Paginated queries require limit(n) before paginate().",
      );
    }

    if (
      continuationToken !== undefined &&
      continuationToken.trim().length === 0
    ) {
      throw new TypeError(
        "Continuation token must be a non-empty string when provided.",
      );
    }

    return new CosmosPaginatedQuery(
      this,
      continuationToken?.trim() || undefined,
    );
  }

  async paginate(
    continuationToken?: string,
  ): Promise<CosmosPaginatedResult<TModel>> {
    return this.requireRepository().executePaginatedQuery(this, {
      continuationToken,
    });
  }

  build(): CosmosQueryDefinition {
    return this.buildDefinition(true);
  }

  buildForPagination(): CosmosQueryDefinition {
    return this.buildDefinition(false);
  }

  getLimit(): number | undefined {
    return this.limitValue;
  }

  getSelectedFields(): readonly CosmosFieldName<TModel>[] {
    return [...this.selectedFields];
  }

  getEagerRelations(): string[] {
    return [...this.eagerRelations];
  }

  getTargetModel(): TModel | undefined {
    return this.targetModel;
  }

  getModelClass(): CosmosModelConstructor<TModel> | undefined {
    return this.modelClass;
  }

  private buildDefinition(includeTopClause: boolean): CosmosQueryDefinition {
    const queryParts: string[] = [this.buildSelectClause(includeTopClause)];
    const whereClause = this.buildWhereClause();

    if (whereClause) {
      queryParts.push(whereClause);
    }

    if (this.orderClause) {
      queryParts.push(
        `ORDER BY c.${this.orderClause.field} ${this.orderClause.direction}`,
      );
    }

    return {
      query: queryParts.join(" "),
      parameters: this.parameters.map((parameter) => ({ ...parameter })),
    };
  }

  private appendWhereClause<TField extends CosmosFieldName<TModel>>(
    field: TField,
    operator: CosmosQueryOperator,
    value: TModel[TField],
  ): this {
    this.assertOperator(operator);

    const parameterName = `@param${++this.parameterIndex}`;

    this.whereClauses.push({
      field,
      operator,
      parameterName,
    });
    this.parameters.push({
      name: parameterName,
      value,
    });

    return this;
  }

  private buildSelectClause(includeTopClause: boolean): string {
    const selectClause =
      this.selectedFields.length > 0
        ? `SELECT ${this.selectedFields.map((field) => `c.${field}`).join(", ")} FROM c`
        : "SELECT * FROM c";

    if (includeTopClause && this.limitValue) {
      return selectClause.replace("SELECT ", `SELECT TOP ${this.limitValue} `);
    }

    return selectClause;
  }

  private buildWhereClause(): string {
    if (this.whereClauses.length === 0) {
      return "";
    }

    const conditions = this.whereClauses.map(
      ({ field, operator, parameterName }) =>
        `c.${field} ${operator} ${parameterName}`,
    );

    return `WHERE ${conditions.join(" AND ")}`;
  }

  private assertFieldName(field: string): void {
    if (!field.trim()) {
      throw new TypeError("Field name must be a non-empty string.");
    }
  }

  private assertOperator(operator: CosmosQueryOperator): void {
    const supportedOperators: CosmosQueryOperator[] = [
      "=",
      "!=",
      ">",
      ">=",
      "<",
      "<=",
    ];

    if (!supportedOperators.includes(operator)) {
      throw new TypeError(`Unsupported operator: ${operator}`);
    }
  }

  private assertOrderDirection(direction: CosmosOrderDirection): void {
    if (direction !== "ASC" && direction !== "DESC") {
      throw new TypeError(`Unsupported order direction: ${direction}`);
    }
  }

  private requireRepository(): CosmosRegisteredRepository<TModel> {
    if (!this.repository) {
      throw new TypeError("This query builder is not bound to a repository.");
    }

    return this.repository;
  }

  private requireTargetModel(): TModel {
    if (!this.targetModel) {
      throw new TypeError(
        "patch(), update(), and delete() require an instance-bound query builder. Use model.$query().",
      );
    }

    return this.targetModel;
  }
}
