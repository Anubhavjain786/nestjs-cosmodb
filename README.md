# NestJS Cosmos ORM

A clean, type-safe ORM-like abstraction for Azure Cosmos DB in NestJS — inspired by objection.js.

## ✨ Why this library?

Working with Azure Cosmos DB in NestJS often leads to:

* Direct SDK usage scattered across services
* No structure for models or repositories
* Lack of consistency in queries and data access

This library solves that by providing:

* ✅ Repository pattern
* ✅ Model abstraction with instance methods
* ✅ Query builder (chainable API)
* ✅ Relation loading system
* ✅ Pagination support
* ✅ Clean NestJS integration

---

## 🚀 Features

* ORM-like developer experience (inspired by objection.js)
* Fully typed (TypeScript-first)
* No Cosmos SDK leakage outside repository
* Partition key abstraction
* Relation support (`@HasMany`, `@BelongsTo`)
* Pagination using continuation tokens
* Safe update & patch operations

---

## 📦 Installation

```bash
npm install nestjs-cosmodb @azure/cosmos
```

---

## ⚡ Quick Example

### 1. Define Model

```ts
@CosmosModel('users')
@PartitionKey('id')
export class User extends BaseModel {
  id: string;
  name: string;
}
```

---

### 2. Use Repository

```ts
const user = await userRepository.create({
  id: 'u1',
  name: 'John',
});
```

---

### 3. Query API

```ts
await User.query().where('name', '=', 'John').first();
```

---

### 4. Instance Methods

```ts
await user.$query().patch({ name: 'Updated' });
```

---

### 5. Relations

```ts
await user.$load('posts');
```

---

### 6. Pagination

```ts
const result = await userRepository
  .query()
  .limit(10)
  .paginate();

console.log(result.data, result.nextToken);
```

---

## ⚠️ Important Notes

### Partition Key Strategy

* Default recommendation: use `id` as partition key
* Avoid cross-partition queries for better performance

---

### Cosmos DB Limitations

* No joins (relations are manually resolved)
* Transactions limited to same partition
* Pagination uses continuation tokens (not offset)

---

## 🏗 Architecture

```
Controller → Service → Repository → Cosmos DB
                     ↑
                  Model
```

---

## 🧠 Philosophy

This library does NOT try to replicate SQL ORM behavior.

Instead, it provides:

> A structured, predictable, and scalable way to work with Cosmos DB in NestJS.

---

## 📌 Roadmap

* [ ] Advanced eager loading
* [ ] Query optimization helpers
* [ ] Indexing guidance
* [ ] Multi-tenant support

---

## 🤝 Contributing

PRs are welcome. Feel free to open issues for suggestions or bugs.

---

## 📄 License

MIT
