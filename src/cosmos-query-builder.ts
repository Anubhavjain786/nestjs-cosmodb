import {
  CosmosPaginatedResult,
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

export class CosmosPaginatedQuery<TModel extends object> {
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
}

export class CosmosQueryBuilder<TModel extends object> {
  private readonly parameters: CosmosQueryParameter[] = [];
  private readonly whereClauses: CosmosWhereClause<TModel>[] = [];
  private orderClause?: CosmosOrderClause<TModel>;
  private limitValue?: number;
  private parameterIndex = 0;

  where<TField extends CosmosFieldName<TModel>>(
    field: TField,
    operator: CosmosQueryOperator,
    value: TModel[TField],
  ): this {
    this.assertFieldName(field);
    this.whereClauses.length = 0;
    this.parameters.length = 0;
    this.parameterIndex = 0;

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

  paginate(continuationToken?: string): CosmosPaginatedQuery<TModel> {
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

  build(): CosmosQueryDefinition {
    return this.buildDefinition(true);
  }

  buildForPagination(): CosmosQueryDefinition {
    return this.buildDefinition(false);
  }

  getLimit(): number | undefined {
    return this.limitValue;
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
    if (includeTopClause && this.limitValue) {
      return `SELECT TOP ${this.limitValue} * FROM c`;
    }

    return "SELECT * FROM c";
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
}
