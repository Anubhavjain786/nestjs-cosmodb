# 🚀 NestJS Cosmos ORM

> A clean, type-safe ORM abstraction for Azure Cosmos DB in NestJS

A structured data layer for NestJS applications using Azure Cosmos DB, providing models, repositories, and a powerful query API — without exposing low-level SDK complexity.

---

# ⚡ 2-Minute Quick Start

```ts
@CosmosModel('users')
@PartitionKey('id')
export class User extends BaseModel {
  id: string;
  name: string;
}

const user = await userRepository.create({
  id: 'u1',
  name: 'John',
});

await user.$query().patch({ name: 'Updated' });

const result = await User.query().where('name', '=', 'John').first();
```

---

# ✨ Features

* 🧱 Structured data layer (Model + Repository)
* 🔗 Model instance methods (`$query`, `$load`)
* 🔍 Chainable query builder
* 🔄 Patch vs Update support
* 🔗 Relation system (`@HasMany`, `@BelongsTo`)
* 📄 Pagination using continuation tokens
* ⚡ Optimized for Cosmos DB patterns
* 🛡 No SDK leakage outside repository
* 🧾 Fully typed (TypeScript-first)

---

# 🤔 Why this library?

Working directly with Azure Cosmos DB often leads to:

* Scattered SDK usage across services
* Repetitive query logic
* Lack of structure in data access

This library provides a consistent, scalable approach:

```ts
// Instead of low-level SDK usage
User.query().where('name', '=', 'John')
```

---

# 📦 Installation

```bash
npm install nestjs-cosmodb @azure/cosmos
```

---

# 🧱 Setup

## 1. Register CosmosModule

```ts
import { CosmosModule } from 'nestjs-cosmodb';

@Module({
  imports: [
    CosmosModule.forRoot({
      endpoint: process.env.COSMOS_ENDPOINT,
      key: process.env.COSMOS_KEY,
      database: 'my-db',
    }),
  ],
})
export class AppModule {}
```

---

## 2. Define a Model

```ts
import { BaseModel, CosmosModel, PartitionKey } from 'nestjs-cosmodb';

@CosmosModel('users')
@PartitionKey('id') // recommended
export class User extends BaseModel {
  id: string;
  name: string;
  email: string;
}
```

---

## 3. Create Repository

```ts
@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(cosmosService) {
    super(cosmosService, User);
  }
}
```

---

## 4. Use in Service

```ts
@Injectable()
export class UserService {
  constructor(private readonly userRepo: UserRepository) {}

  async createUser() {
    return this.userRepo.create({
      id: 'u1',
      name: 'John',
      email: 'john@test.com',
    });
  }
}
```

---

# 🔍 Querying

```ts
// Find by ID
const user = await userRepo.findById('u1');

// Query builder
const users = await User.query()
  .where('name', '=', 'John')
  .limit(10)
  .fetch();

// First result
const user = await User.query().first();
```

---

# ✏️ Updates

## Partial Update

```ts
await user.$query().patch({
  name: 'Updated Name',
});
```

---

## Full Replace

```ts
await user.$query().update({
  id: 'u1',
  name: 'Full Replace',
  email: 'new@test.com',
});
```

---

# ❌ Delete

```ts
await user.$query().delete();
```

---

# 🔗 Relations

## Define relation

```ts
@HasMany(() => Post, 'userId')
posts: Post[];
```

---

## Load relation

```ts
await user.$load('posts');
```

---

# 📄 Pagination

```ts
const result = await userRepo
  .query()
  .limit(10)
  .paginate();

console.log(result.data);
console.log(result.nextToken);
```

---

# ⚠️ Important Notes

## Partition Key Strategy

Recommended:

```ts
@PartitionKey('id')
```

* Enables efficient point reads
* Avoids cross-partition queries
* Simplifies usage

---

## Cosmos DB Limitations

* No joins (relations are resolved manually)
* Transactions are limited to a single partition
* Pagination uses continuation tokens

---

# 🧠 Mental Model

```text
Controller → Service → Repository → Cosmos DB
                     ↑
                  Model
```

---

# 📌 Roadmap

* [ ] Advanced relation loading
* [ ] Query optimization helpers
* [ ] Indexing recommendations
* [ ] Multi-tenant support

---

# 🤝 Contributing

PRs are welcome! Open an issue for suggestions or improvements.

---

# 📄 License

MIT
