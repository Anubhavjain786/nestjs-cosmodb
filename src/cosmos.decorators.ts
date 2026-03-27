import "reflect-metadata";

import {
  COSMOS_MODEL_METADATA,
  COSMOS_PARTITION_KEY_METADATA,
  COSMOS_RELATIONS_METADATA,
} from "./cosmos.constants";
import {
  CosmosModelFactory,
  CosmosModelOptions,
  CosmosRelationMetadata,
  CosmosRelationType,
} from "./cosmos.interfaces";

export function CosmosModel(containerName: string): ClassDecorator {
  const normalizedContainerName = normalizeRequiredValue(
    containerName,
    "containerName",
  );
  const metadata: CosmosModelOptions = {
    containerName: normalizedContainerName,
  };

  return Reflect.metadata(COSMOS_MODEL_METADATA, metadata);
}

export function PartitionKey(fieldName: string): ClassDecorator {
  const normalizedFieldName = normalizeRequiredValue(fieldName, "fieldName");

  return Reflect.metadata(COSMOS_PARTITION_KEY_METADATA, normalizedFieldName);
}

export function HasMany<TInstance extends object>(
  targetFactory: CosmosModelFactory<TInstance>,
  foreignKey: string,
): PropertyDecorator {
  return relationDecorator("has-many", targetFactory, foreignKey);
}

export function BelongsTo<TInstance extends object>(
  targetFactory: CosmosModelFactory<TInstance>,
  foreignKey: string,
): PropertyDecorator {
  return relationDecorator("belongs-to", targetFactory, foreignKey);
}

function relationDecorator<TInstance extends object>(
  relationType: CosmosRelationType,
  targetFactory: CosmosModelFactory<TInstance>,
  foreignKey: string,
): PropertyDecorator {
  if (typeof targetFactory !== "function") {
    throw new TypeError("Relation target factory must be a function.");
  }

  const normalizedForeignKey = normalizeRequiredValue(foreignKey, "foreignKey");

  return (target, propertyKey) => {
    if (typeof propertyKey !== "string") {
      throw new TypeError("Relation property keys must be strings.");
    }

    const modelTarget = resolveMetadataTarget(target);
    const relation: CosmosRelationMetadata<TInstance> = {
      propertyKey,
      type: relationType,
      target: targetFactory,
      foreignKey: normalizedForeignKey,
    };
    const existingRelations = Reflect.getMetadata(
      COSMOS_RELATIONS_METADATA,
      modelTarget,
    ) as CosmosRelationMetadata[] | undefined;
    const nextRelations = [...(existingRelations ?? []), relation];

    Reflect.metadata(COSMOS_RELATIONS_METADATA, nextRelations)(modelTarget);
  };
}

function resolveMetadataTarget(target: object): Function {
  const candidate = (target as { constructor?: unknown }).constructor;

  if (typeof candidate === "function") {
    return candidate;
  }

  throw new TypeError(
    "Relation decorators must be applied to class properties.",
  );
}

function normalizeRequiredValue(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return normalizedValue;
}
