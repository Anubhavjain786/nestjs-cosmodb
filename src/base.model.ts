import { getRelationMetadata } from "./cosmos.metadata";
import {
  CosmosModelInstance,
  CosmosModelRepository,
} from "./cosmos.interfaces";

type BaseModelMethodKeys =
  | "$save"
  | "$update"
  | "$delete"
  | "$load"
  | "attachRepository";

export type BaseModelUpdateData<TModel extends BaseModel> = Partial<
  Omit<TModel, BaseModelMethodKeys>
>;

export abstract class BaseModel implements CosmosModelInstance {
  id = "";
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;

  #repository?: CosmosModelRepository<this>;

  attachRepository(repository: CosmosModelRepository<this>): this {
    this.#repository = repository;

    return this;
  }

  async $save(): Promise<this> {
    const savedModel = await this.getRequiredRepository().save(this);

    return this.assignPersistedState(savedModel);
  }

  async $update(data: BaseModelUpdateData<this>): Promise<this> {
    const updatedModel = await this.getRequiredRepository().update(
      this,
      data as Partial<this>,
    );

    return this.assignPersistedState(updatedModel);
  }

  async $delete(): Promise<void> {
    await this.getRequiredRepository().delete(this);
  }

  async $load(relationName: string): Promise<this> {
    const normalizedRelationName = relationName.trim();

    if (!normalizedRelationName) {
      throw new TypeError("Relation name must be a non-empty string.");
    }

    const relation = getRelationMetadata(this, normalizedRelationName);

    if (!relation) {
      throw new Error(
        `Relation \"${normalizedRelationName}\" is not defined on ${this.constructor.name}.`,
      );
    }

    const relationValue = await this.getRequiredRepository().loadRelation(
      this,
      normalizedRelationName,
    );

    (this as Record<string, unknown>)[normalizedRelationName] = relationValue;

    return this;
  }

  protected getRepository(): CosmosModelRepository<this> | undefined {
    return this.#repository;
  }

  private getRequiredRepository(): CosmosModelRepository<this> {
    if (!this.#repository) {
      throw new Error(
        `Repository has not been attached to ${this.constructor.name}.`,
      );
    }

    return this.#repository;
  }

  private assignPersistedState(model: this): this {
    const repository = this.#repository;

    Object.assign(this, model);

    if (repository) {
      this.#repository = repository;
    }

    return this;
  }
}
