import { DynamicModule, Global, Module } from "@nestjs/common";

import { COSMOS_MODULE_OPTIONS } from "./cosmos.constants";
import { CosmosModuleOptions } from "./cosmos.interfaces";
import { CosmosService } from "./cosmos.service";

@Global()
@Module({})
export class CosmosModule {
  static forRoot(options: CosmosModuleOptions): DynamicModule {
    return {
      module: CosmosModule,
      global: true,
      providers: [
        {
          provide: COSMOS_MODULE_OPTIONS,
          useValue: Object.freeze({ ...options }),
        },
        CosmosService,
      ],
      exports: [CosmosService],
    };
  }
}
