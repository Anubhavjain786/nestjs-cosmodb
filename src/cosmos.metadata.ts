import "reflect-metadata";

import {
  COSMOS_MODEL_METADATA,
  COSMOS_PARTITION_KEY_METADATA,
  COSMOS_RELATIONS_METADATA,
} from "./cosmos.constants";
import {
  CosmosModelMetadata,
  CosmosModelOptions,
  CosmosModelTarget,
  CosmosRelationMetadata,
} from "./cosmos.interfaces";

export function getModelMetadata(
  model: CosmosModelTarget,
): CosmosModelMetadata | undefined {
  const target = resolveMetadataTarget(model);
  const modelOptions = Reflect.getMetadata(COSMOS_MODEL_METADATA, target) as
    | CosmosModelOptions
    | undefined;

  if (!modelOptions) {
    return undefined;
  }

  return {
    containerName: modelOptions.containerName,
    partitionKey: getPartitionKey(model),
    relations: getRelations(model),
  };
}

export function getPartitionKey(model: CosmosModelTarget): string | undefined {
  const target = resolveMetadataTarget(model);

  return Reflect.getMetadata(COSMOS_PARTITION_KEY_METADATA, target) as
    | string
    | undefined;
}

export function getRelations(
  model: CosmosModelTarget,
): CosmosRelationMetadata[] {
  const target = resolveMetadataTarget(model);
  const relations = Reflect.getMetadata(COSMOS_RELATIONS_METADATA, target) as
    | CosmosRelationMetadata[]
    | undefined;

  return [...(relations ?? [])];
}

export function getRelationMetadata(
  model: CosmosModelTarget,
  relationName: string,
): CosmosRelationMetadata | undefined {
  const normalizedRelationName = relationName.trim();

  if (!normalizedRelationName) {
    return undefined;
  }

  return getRelations(model).find(
    ({ propertyKey }) => propertyKey === normalizedRelationName,
  );
}

function resolveMetadataTarget(model: CosmosModelTarget): object {
  if (typeof model === "function") {
    return model;
  }

  const candidate = (model as { constructor?: unknown }).constructor;

  if (typeof candidate === "function") {
    return candidate;
  }

  return model;
}
