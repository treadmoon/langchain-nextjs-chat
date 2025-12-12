# Supabase 向量数据库设置指南

## 📋 概述

本指南将教你如何在 Supabase 中设置 pgvector 向量表和匹配函数，以支持 LangChain RAG 应用的向量检索。

## ✅ 前置准备

1. **Supabase 项目**：已创建 Supabase 账户和项目
2. **SQL Editor 访问权限**：能够访问 Supabase 项目的 SQL Editor
3. **环境变量配置**：已在项目中配置以下环境变量：
   - `NEXT_PUBLIC_SUPABASE_URL`：你的 Supabase 项目 URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`：Supabase 匿名 Key（用于前端）

## 🚀 快速开始（3 步）

### 步骤 1：打开 Supabase SQL Editor

1. 登录 [Supabase Dashboard](https://app.supabase.com)
2. 选择你的项目
3. 左侧导航栏 → **SQL Editor** → **New Query**

### 步骤 2：复制并执行 SQL 脚本

1. 打开项目根目录下的 `SUPABASE_SETUP.sql` 文件
2. **复制全部内容**
3. 粘贴到 Supabase SQL Editor
4. 点击右上角 **「Run」** 按钮执行

**预期结果**：
- 创建 `documents` 表
- 创建 `match_documents()` 函数
- 创建向量索引和自动时间戳更新触发器

### 步骤 3：验证设置成功

在 SQL Editor 中执行以下查询验证：

```sql
-- 查看 documents 表结构
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'documents';

-- 查看 match_documents 函数是否存在
SELECT proname, pronargs 
FROM pg_proc 
WHERE proname = 'match_documents';

-- 列出所有索引
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'documents';
```

如果上述查询都返回结果，说明设置成功！

## 📊 数据库表结构详解

### `documents` 表

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | BIGSERIAL | 主键，自增 ID |
| `content` | TEXT | 文档的实际文本内容 |
| `embedding` | vector(3072) | OpenAI Embeddings 生成的向量（3072 维） |
| `metadata` | JSONB | 元数据，存储文档的来源、标题、章节等信息 |
| `created_at` | TIMESTAMP | 创建时间，自动设为当前时间 |
| `updated_at` | TIMESTAMP | 最后修改时间，每次更新自动更新 |

**向量维度说明**：
- OpenAI 的 `text-embedding-3-small` 和 `text-embedding-3-large` 都使用 **3072 维向量**
- 如果使用其他 Embedding 模型，需要修改 `vector(3072)` 为对应维度

### `match_documents()` 函数

**功能**：根据查询向量找到最相似的文档

**参数**：
- `query_embedding` (vector(3072))：查询向量（必需）
- `match_count` (INT, 默认 10)：返回的结果数
- `filter` (JSONB, 默认 NULL)：元数据过滤条件（可选）

**返回值**：
```
{
  id: 文档 ID,
  content: 文档内容,
  metadata: 文档元数据,
  similarity: 相似度分数 (0-1)
}
```

**使用示例**：

```sql
-- 基础搜索：返回最相似的 5 条文档
SELECT * FROM match_documents(
  query_embedding => '[0.1, 0.2, 0.3, ...]'::vector,
  match_count => 5
);

-- 带过滤的搜索：只搜索特定来源的文档
SELECT * FROM match_documents(
  query_embedding => '[0.1, 0.2, 0.3, ...]'::vector,
  match_count => 10,
  filter => '{"source": "user_upload"}'::jsonb
);
```

## 🔌 在 LangChain 中使用

代码中的 `SupabaseVectorStore` 会自动调用 `match_documents()` 函数：

```typescript
const vectorstore = new SupabaseVectorStore(embeddings, {
  client,
  tableName: "documents",        // 表名必须是 documents
  queryName: "match_documents",  // 函数名必须是 match_documents
});

// LangChain 会自动调用 match_documents() 进行向量搜索
const retriever = vectorstore.asRetriever();
```

## 📝 常见任务

### 插入文档

通过 LangChain 自动插入：

```typescript
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";

const vectorstore = new SupabaseVectorStore(embeddings, {
  client,
  tableName: "documents",
});

// 添加文档（自动生成向量）
await vectorstore.addDocuments([
  {
    pageContent: "文档内容",
    metadata: {
      source: "user_upload",
      title: "文档标题",
      date: "2024-12-12"
    }
  }
]);
```

或手动插入（通过 SQL）：

```sql
INSERT INTO documents (content, embedding, metadata)
VALUES (
  '你的文档内容',
  '[0.1, 0.2, 0.3, ...]'::vector,  -- 需要由 OpenAI Embeddings API 生成
  '{"source": "manual", "title": "示例"}'::jsonb
);
```

### 查看所有文档

```sql
SELECT id, content, metadata, created_at 
FROM documents 
ORDER BY created_at DESC 
LIMIT 10;
```

### 搜索文档

```sql
-- 使用向量相似度搜索
SELECT id, content, metadata, 
       1 - (embedding <=> '[0.1, 0.2, ...]'::vector) as similarity
FROM documents
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 5;
```

### 删除文档

```sql
DELETE FROM documents WHERE id = 123;
```

### 更新文档元数据

```sql
UPDATE documents 
SET metadata = '{"source": "updated_source"}'::jsonb
WHERE id = 123;
```

## 🔐 安全性考虑

### 行级安全（RLS）

如果你的应用需要限制用户只能访问自己的数据，可以启用 RLS。SQL 脚本中已包含注释的 RLS 策略示例。

### 匿名 Key 权限

确保 Supabase 的匿名 Key 只被授予必要的权限：

```sql
-- 检查当前权限
SELECT * FROM information_schema.role_table_grants 
WHERE grantee = 'anon';
```

## 🚨 常见问题

### Q: 能否使用其他维度的向量？

**A**: 可以，但需要修改 SQL：

```sql
-- 如果使用 1536 维向量（如 text-embedding-ada-002）
CREATE TABLE documents (
  ...
  embedding vector(1536),
  ...
);

-- 相应修改函数参数
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  ...
) ...
```

### Q: 如何加快向量搜索性能？

**A**: 脚本中已创建 IVFFlat 索引，进一步优化：

```sql
-- 对于大数据集（>100K 文档），考虑使用 HNSW 索引（需要 pgvector 0.5+）
CREATE INDEX IF NOT EXISTS documents_embedding_hnsw 
  ON documents 
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### Q: 如何查看向量索引大小？

**A**:

```sql
SELECT 
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelname::regclass)) as size
FROM pg_indexes
WHERE tablename = 'documents';
```

### Q: 向量搜索返回的相似度分数是什么含义？

**A**: 
- **1.0**：完全相同的向量（相似度最高）
- **0.5**：中等相似度
- **0.0**：正交的向量（完全不相关）
- **负数**：反向的向量（意义相反）

## 📚 参考资源

- [Supabase pgvector 文档](https://supabase.com/docs/guides/ai/pgvector)
- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [OpenAI Embeddings API](https://platform.openai.com/docs/api-reference/embeddings)
- [LangChain SupabaseVectorStore](https://js.langchain.com/docs/modules/data_connection/vectorstores/integrations/supabase)

## ✨ 后续步骤

1. ✅ 执行 SQL 脚本创建表和函数
2. ✅ 验证数据库设置成功
3. ✅ 在应用中测试向量插入和检索
4. ✅ 根据需要启用 RLS 和其他安全措施
5. ✅ 监控向量搜索性能并优化索引

祝你使用愉快！如有问题，请参考官方文档或联系 Supabase 支持。
