-- =====================================================
-- Supabase pgvector 向量表与函数建立脚本
-- =====================================================
-- 这个脚本用来在 Supabase 中创建用于存放文档向量的表和匹配函数
-- 直接在 Supabase SQL Editor 中执行即可

-- 第一步：启用 pgvector 扩展（如果还未启用）
CREATE EXTENSION IF NOT EXISTS vector;

-- 第二步：创建文档表（documents）
-- 该表用于存储文档内容、元数据和对应的向量
CREATE TABLE IF NOT EXISTS documents (
  -- 主键：文档唯一标识符
  id BIGSERIAL PRIMARY KEY,
  
  -- 文档内容：实际的文本内容
  content TEXT NOT NULL,
  
  -- 向量：OpenAI Embeddings 生成的向量（维度 1536）
  -- vector(1536) 表示这是一个 1536 维的向量
  embedding vector(1536),
  
  -- 元数据：JSON 格式，存储关于文档的附加信息
  -- 例如：来源、日期、作者、章节等
  metadata JSONB,
  
  -- 创建时间：记录文档插入的时间戳（自动设为当前时间）
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- 更新时间：记录文档最后修改的时间戳（每次更新自动更新）
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 第三步：在 embedding 列上创建向量索引
-- 这个索引加快向量相似度搜索的速度（使用 IVFFlat 算法）
-- 更多向量搜索性能请参考：https://supabase.com/docs/guides/ai/pgvector
CREATE INDEX IF NOT EXISTS documents_embedding_index 
  ON documents 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 第四步：创建向量匹配函数（match_documents）
-- 这个函数返回与给定向量最相似的 N 条文档
-- 前端应用和 LangChain 会调用这个函数来进行 RAG（检索增强生成）
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),   -- 输入：查询向量（由 OpenAI Embeddings 生成）
  match_count INT DEFAULT 10,      -- 输入：返回的最相似文档数（默认 10 条）
  filter JSONB DEFAULT NULL        -- 输入：可选的元数据过滤条件
)
RETURNS TABLE (
  id BIGINT,                       -- 返回：文档 ID
  content TEXT,                    -- 返回：文档内容
  metadata JSONB,                  -- 返回：文档元数据
  similarity FLOAT8                -- 返回：相似度分数（0-1，越接近 1 越相似）
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    documents.id,
    documents.content,
    documents.metadata,
    -- 计算余弦相似度：向量之间的夹角越小，相似度越高
    -- 1 - (两个向量的余弦距离) = 相似度
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  WHERE
    -- 如果提供了元数据过滤条件，应用过滤
    CASE 
      WHEN filter IS NOT NULL THEN documents.metadata @> filter
      ELSE TRUE
    END
  ORDER BY
    -- 按相似度从高到低排序
    documents.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 第五步：创建自动更新 updated_at 的触发器
-- 这样每次更新 documents 表时，updated_at 字段会自动更新为当前时间
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器（如果不存在）
DROP TRIGGER IF EXISTS update_documents_updated_at ON documents;
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 第六步：创建行级安全策略（RLS，可选但推荐）
-- 如果需要限制用户只能读取自己的文档，可以启用 RLS
-- 这里先注释掉，如需启用请取消注释并根据实际需求修改

/*
-- 启用表的 RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- 允许所有认证用户查看所有文档（RAG 场景通常需要全局访问）
CREATE POLICY "Allow read access to all documents for authenticated users"
  ON documents
  FOR SELECT
  TO authenticated
  USING (true);

-- 只允许创建者插入和更新自己的文档
CREATE POLICY "Allow insert for authenticated users"
  ON documents
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update own documents"
  ON documents
  FOR UPDATE
  TO authenticated
  USING (true);
*/

-- =====================================================
-- 执行完成！
-- =====================================================
-- 你现在可以：
-- 1. 通过 LangChain 的 SupabaseVectorStore 插入文档和向量
-- 2. 通过 JavaScript/Python 调用 match_documents() 进行向量搜索
-- 3. 检查 documents 表中的数据和元数据
-- 
-- 查看表结构：
--   SELECT * FROM documents LIMIT 5;
-- 
-- 测试向量搜索（需要先插入一些数据）：
--   SELECT * FROM match_documents(
--     query_embedding => <你的向量>,
--     match_count => 5
--   );
-- =====================================================
