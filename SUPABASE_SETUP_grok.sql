-- 1. 启用 pgvector 扩展（只需执行一次）
create extension if not exists vector with schema public;

-- 2. 创建 documents 表（LangChain SupabaseVectorStore 要求的固定结构）
create table if not exists documents (
  id uuid primary key default uuid_generate_v4(),        -- 主键
  content text,                                          -- 原始文本
  metadata jsonb,                                        -- 任意元数据
  embedding vector(1024)                                 -- 根据你的 embeddings 维度修改！
                                                         -- OpenAI text-embedding-3-small → 1024
                                                         -- text-embedding-3-large → 3072
                                                         -- 其他模型（如 Cohere、local）请对应修改
);

-- 3. 创建向量相似度搜索函数（必须函数名就是 match_documents）
create or replace function match_documents(
  query_embedding vector(1024),     -- 维度必须和上面 embedding 列一致
  match_threshold float default 0.78,   -- 相似度阈值（余弦相似度）
  match_count int default 10            -- 返回最多多少条
)
returns table(
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) as similarity   -- <=> 是 pgvector 的余弦距离运算符
  from documents
  where 1 - (documents.embedding <=> query_embedding) > match_threshold
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- 4. （可选但强烈推荐）为 embedding 列创建索引，大幅提升检索速度
create index if not exists documents_embedding_idx 
on documents using ivfflat (embedding vector_cosine_ops) 
with (lists = 100);   -- lists 根据数据量调整，100~1000 常用