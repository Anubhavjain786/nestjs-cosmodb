import { Inject, Injectable, Logger } from "@nestjs/common";
import { Container, CosmosClient, Database } from "@azure/cosmos";

import { COSMOS_MODULE_OPTIONS } from "./cosmos.constants";
import { CosmosModuleOptions } from "./cosmos.interfaces";

@Injectable()
export class CosmosService {
  private readonly logger = new Logger(CosmosService.name);
  private readonly client: CosmosClient;
  private readonly database: Database;
  private readonly containers = new Map<string, Container>();

  constructor(
    @Inject(COSMOS_MODULE_OPTIONS)
    private readonly options: CosmosModuleOptions,
  ) {
    this.assertValidOptions(options);

    this.client = new CosmosClient({
      endpoint: options.endpoint,
      key: options.key,
      ...options.clientOptions,
    });
    this.database = this.client.database(options.database);
  }

  getContainer(containerName: string): Container {
    const normalizedName = containerName.trim();

    if (!normalizedName) {
      throw new Error("Container name must be a non-empty string.");
    }

    const cachedContainer = this.containers.get(normalizedName);
    if (cachedContainer) {
      return cachedContainer;
    }

    const container = this.database.container(normalizedName);
    this.containers.set(normalizedName, container);
    this.logger.debug(`Cached Cosmos container: ${normalizedName}`);

    return container;
  }

  private assertValidOptions(options: CosmosModuleOptions): void {
    if (!options.endpoint.trim()) {
      throw new Error("Cosmos endpoint is required.");
    }

    if (!options.key.trim()) {
      throw new Error("Cosmos key is required.");
    }

    if (!options.database.trim()) {
      throw new Error("Cosmos database is required.");
    }
  }
}
