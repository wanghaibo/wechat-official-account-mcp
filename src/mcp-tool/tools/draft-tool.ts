import { WechatToolDefinition, McpTool, WechatApiClient, WechatToolContext, WechatToolResult } from '../types.js';
import { logger } from '../../utils/logger.js';
import { z } from 'zod';
import { mediaIdSchema } from '../../utils/validation.js';

// 草稿工具参数 Schema (内部使用)
const draftToolSchema = z.object({
  action: z.enum(['add', 'get', 'delete', 'list', 'count']),
  mediaId: mediaIdSchema.optional(),
  articles: z.array(z.any()).optional(),
  offset: z.number().int().min(0).optional(),
  count: z.number().int().min(1).max(20).optional(),
});

/**
 * 草稿工具核心处理逻辑
 * 统一处理所有草稿相关操作
 */
async function handleDraftOperations(
  action: string,
  params: {
    mediaId?: string;
    articles?: any[];
    offset?: number;
    count?: number;
  },
  apiClient: WechatApiClient
): Promise<WechatToolResult> {
  switch (action) {
    case 'add': {
      const { articles } = params;

      if (!articles || articles.length === 0) {
        throw new Error('文章内容不能为空');
      }

      try {
        const result = await apiClient.post('/cgi-bin/draft/add', {
          articles: articles.map((article: any) => {
            // 判断文章类型
            const hasImageInfo = article.imageInfo !== undefined;
            const articleType = hasImageInfo ? 'newspic' : 'news';

            // 通用字段
            const baseFields: any = {
              article_type: articleType,
              need_open_comment: article.needOpenComment ?? 0,
              only_fans_can_comment: article.onlyFansCanComment ?? 0,
            };

            if (articleType === 'news') {
              // 图文消息字段
              return {
                ...baseFields,
                title: article.title,
                author: article.author || '',
                digest: article.digest || '',
                content: article.content,
                content_source_url: article.contentSourceUrl || '',
                thumb_media_id: article.thumbMediaId,
                show_cover_pic: article.showCoverPic ?? 0,
                pic_crop_235_1: article.picCrop2351 || '',
                pic_crop_1_1: article.picCrop11 || '',
              };
            } else {
              // 图片消息字段
              const newsPicFields: any = {
                title: article.title,
                content: article.content,
              };

              if (article.imageInfo) {
                newsPicFields.image_info = {
                  image_list: article.imageInfo.image_list.map((img: any) => ({
                    image_media_id: img.image_media_id,
                  })),
                };
              }

              if (article.coverInfo) {
                newsPicFields.cover_info = {
                  crop_percent_list: (article.coverInfo.crop_percent_list || []).map((crop: any) => ({
                    ratio: crop.ratio,
                    x1: crop.x1,
                    y1: crop.y1,
                    x2: crop.x2,
                    y2: crop.y2,
                  })),
                };
              }

              if (article.productInfo) {
                newsPicFields.product_info = {
                  footer_product_info: article.productInfo.footer_product_info,
                };
              }

              return {
                ...baseFields,
                ...newsPicFields,
              };
            }
          })
        }) as any;

        return {
          content: [{
            type: 'text',
            text: `草稿创建成功！\n草稿ID: ${result.media_id}\n包含文章数: ${articles.length}`,
          }],
        };
      } catch (error) {
        throw new Error(`创建草稿失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }

    case 'get': {
      const { mediaId } = params;

      if (!mediaId) {
        throw new Error('草稿ID不能为空');
      }

      try {
        const result = await apiClient.post('/cgi-bin/draft/get', {
          media_id: mediaId
        }) as any;

        const articles = result.news_item.map((item: any, index: number) =>
          `第${index + 1}篇:\n` +
          `标题: ${item.title}\n` +
          `作者: ${item.author || '未设置'}\n` +
          `摘要: ${item.digest || '无'}\n` +
          `内容: ${item.content.substring(0, 100)}${item.content.length > 100 ? '...' : ''}\n` +
          `原文链接: ${item.content_source_url || '无'}\n` +
          `封面图ID: ${item.thumb_media_id}\n` +
          `显示封面: ${item.show_cover_pic ? '是' : '否'}\n`
        ).join('\n');

        return {
          content: [{
            type: 'text',
            text: `获取草稿成功！\n草稿ID: ${mediaId}\n创建时间: ${new Date(result.create_time * 1000).toLocaleString()}\n更新时间: ${new Date(result.update_time * 1000).toLocaleString()}\n\n${articles}`,
          }],
        };
      } catch (error) {
        throw new Error(`获取草稿失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }

    case 'delete': {
      const { mediaId } = params;

      if (!mediaId) {
        throw new Error('草稿ID不能为空');
      }

      try {
        await apiClient.post('/cgi-bin/draft/delete', {
          media_id: mediaId
        }) as any;

        return {
          content: [{
            type: 'text',
            text: `草稿删除成功！\n草稿ID: ${mediaId}`,
          }],
        };
      } catch (error) {
        throw new Error(`删除草稿失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }

    case 'list': {
      const { offset = 0, count = 20 } = params;

      try {
        const result = await apiClient.post('/cgi-bin/draft/batchget', {
          offset,
          count
        }) as any;

        const draftList = result.item.map((item: any, index: number) => {
          const firstArticle = item.content.news_item[0];
          const articleCount = item.content.news_item.length;

          return `${offset + index + 1}. 草稿ID: ${item.media_id}\n` +
                 `   标题: ${firstArticle.title}${articleCount > 1 ? ` (共${articleCount}篇)` : ''}\n` +
                 `   作者: ${firstArticle.author || '未设置'}\n` +
                 `   创建时间: ${new Date(item.content.create_time * 1000).toLocaleString()}\n` +
                 `   更新时间: ${new Date(item.content.update_time * 1000).toLocaleString()}`;
        }).join('\n\n');

        return {
          content: [{
            type: 'text',
            text: `草稿列表 (${offset + 1}-${offset + result.item.length}/${result.total_count}):\n\n${draftList}`,
          }],
        };
      } catch (error) {
        throw new Error(`获取草稿列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }

    case 'count': {
      try {
        const result = await apiClient.post('/cgi-bin/draft/count') as any;

        return {
          content: [{
            type: 'text',
            text: `草稿统计信息：\n草稿总数: ${result.total_count} 个`,
          }],
        };
      } catch (error) {
        throw new Error(`获取草稿统计失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * 草稿工具处理器 (WechatToolContext)
 */
async function handleDraftTool(context: WechatToolContext): Promise<WechatToolResult> {
  const { args, apiClient } = context;

  try {
    const validatedArgs = draftToolSchema.parse(args);
    const { action, mediaId, articles, offset, count } = validatedArgs;

    return await handleDraftOperations(action, { mediaId, articles, offset, count }, apiClient);
  } catch (error) {
    logger.error('Draft tool error:', error);
    return {
      content: [{
        type: 'text',
        text: `草稿操作失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }],
      isError: true,
    };
  }
}

/**
 * MCP草稿工具处理器 (直接参数)
 */
async function handleDraftMcpTool(args: unknown, apiClient: WechatApiClient): Promise<WechatToolResult> {
  const { action, mediaId, articles, offset = 0, count = 20 } = args as any;

  try {
    // 处理 articles 数组格式（旧版兼容）和平铺参数格式（新版）
    let processedArticles: any[] = [];

    if (articles && Array.isArray(articles) && articles.length > 0) {
      // 旧版：直接传入 articles 数组
      processedArticles = articles;
    } else {
      // 新版：根据 articleType 构建文章对象
      const {
        articleType = 'news',
        title,
        author,
        digest,
        content,
        contentSourceUrl,
        thumbMediaId,
        showCoverPic,
        needOpenComment,
        onlyFansCanComment,
        picCrop2351,
        picCrop11,
        imageInfo,
        coverInfo,
        productInfo,
      } = args as any;

      if (action === 'add') {
        // 验证必需字段
        if (!title) {
          throw new Error('文章标题(title)不能为空');
        }
        if (!content) {
          throw new Error('文章内容(content)不能为空');
        }

        if (articleType === 'news') {
          // 图文消息
          if (!thumbMediaId) {
            throw new Error('图文消息的thumbMediaId(封面图片媒体ID)不能为空');
          }
          processedArticles = [{
            title,
            author,
            digest,
            content,
            contentSourceUrl,
            thumbMediaId,
            showCoverPic,
            needOpenComment,
            onlyFansCanComment,
            picCrop2351,
            picCrop11,
          }];
        } else {
          // 图片消息
          if (!imageInfo || !imageInfo.image_list || imageInfo.image_list.length === 0) {
            throw new Error('图片消息的imageInfo.image_list(图片列表)不能为空');
          }
          processedArticles = [{
            title,
            content,
            needOpenComment,
            onlyFansCanComment,
            imageInfo,
            coverInfo,
            productInfo,
          }];
        }
      }
    }

    return await handleDraftOperations(action, { mediaId, articles: processedArticles, offset, count }, apiClient);
  } catch (error) {
    logger.error('Draft MCP tool error:', error);
    return {
      content: [{
        type: 'text',
        text: `草稿操作失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }],
      isError: true,
    };
  }
}

/**
 * 微信公众号草稿管理工具
 */
export const draftTool: WechatToolDefinition = {
  name: 'wechat_draft',
  description: '管理微信公众号草稿',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'get', 'delete', 'list', 'count'],
        description: '操作类型',
      },
      mediaId: {
        type: 'string',
        description: '草稿 Media ID',
      },
    },
    required: ['action'],
  },
  handler: handleDraftTool,
};

/**
 * MCP草稿工具
 */

// 图文消息文章 Schema
const mcpNewsArticleSchema = z.object({
  title: z.string().describe('文章标题（不超过32字）'),
  author: z.string().optional().describe('作者（不超过16字）'),
  digest: z.string().optional().describe('摘要（不超过128字）'),
  content: z.string().describe('文章内容'),
  contentSourceUrl: z.string().optional().describe('原文链接'),
  thumbMediaId: z.string().describe('封面图片媒体ID（必须是永久MediaID）'),
  showCoverPic: z.number().optional().describe('是否显示封面图片'),
  needOpenComment: z.number().optional().describe('是否开启评论'),
  onlyFansCanComment: z.number().optional().describe('是否仅粉丝可评论'),
  picCrop2351: z.string().optional().describe('封面裁剪2.35:1坐标'),
  picCrop11: z.string().optional().describe('封面裁剪1:1坐标'),
});

// 图片消息 Schema
const mcpImageListItemSchema = z.object({
  image_media_id: z.string().describe('图片素材ID（必须是永久MediaID）'),
});

const mcpCoverCropSchema = z.object({
  ratio: z.string().optional().describe('裁剪比例："1_1"、"16_9"、"2.35_1"'),
  x1: z.string().optional().describe('左上角X坐标'),
  y1: z.string().optional().describe('左上角Y坐标'),
  x2: z.string().optional().describe('右下角X坐标'),
  y2: z.string().optional().describe('右下角Y坐标'),
});

// 图片消息文章 Schema
const mcpNewsPicArticleSchema = z.object({
  title: z.string().describe('图片消息标题（不超过32字）'),
  content: z.string().describe('图片消息内容（支持商品标签，不超过50个商品）'),
  needOpenComment: z.number().optional().describe('是否开启评论'),
  onlyFansCanComment: z.number().optional().describe('是否仅粉丝可评论'),
  imageInfo: z.object({
    image_list: z.array(mcpImageListItemSchema).min(1).max(20).describe('图片列表，最多20张，首张为封面'),
  }).describe('图片信息（图片消息必需）'),
  coverInfo: z.object({
    crop_percent_list: z.array(mcpCoverCropSchema).optional().describe('封面裁剪信息'),
  }).optional().describe('封面信息'),
  productInfo: z.object({
    footer_product_info: z.object({
      product_key: z.string().optional().describe('商品key'),
    }).optional(),
  }).optional().describe('商品信息'),
});

export const draftMcpTool: McpTool = {
  name: 'wechat_draft',
  description: '管理微信公众号草稿，支持图文消息(news)和图片消息(newspic)两种类型',
  inputSchema: {
    action: z.enum(['add', 'get', 'delete', 'list', 'count']).describe('操作类型：add(创建), get(获取), delete(删除), list(列表), count(统计)'),
    mediaId: z.string().optional().describe('草稿 Media ID（获取、删除时必需）'),
    articleType: z.enum(['news', 'newspic']).optional().describe('文章类型：news(图文消息,默认), newspic(图片消息)'),
    // 图文消息字段
    title: z.string().optional().describe('文章标题（不超过32字）'),
    author: z.string().optional().describe('作者（不超过16字）'),
    digest: z.string().optional().describe('摘要（不超过128字，仅单图文有效）'),
    content: z.string().optional().describe('文章内容'),
    contentSourceUrl: z.string().optional().describe('原文链接'),
    thumbMediaId: z.string().optional().describe('封面图片媒体ID（图文消息必填，必须是永久MediaID）'),
    showCoverPic: z.number().optional().describe('是否显示封面图片'),
    picCrop2351: z.string().optional().describe('封面裁剪2.35:1坐标，格式：X1_Y1_X2_Y2'),
    picCrop11: z.string().optional().describe('封面裁剪1:1坐标，格式：X1_Y1_X2_Y2'),
    // 图片消息字段
    imageInfo: z.object({
      image_list: z.array(z.object({
        image_media_id: z.string().describe('图片素材ID（必须是永久MediaID）'),
      })).min(1).max(20).describe('图片列表，最多20张，首张为封面图'),
    }).optional().describe('图片消息图片列表'),
    coverInfo: z.object({
      crop_percent_list: z.array(z.object({
        ratio: z.string().optional(),
        x1: z.string().optional(),
        y1: z.string().optional(),
        x2: z.string().optional(),
        y2: z.string().optional(),
      })).optional(),
    }).optional().describe('封面裁剪信息'),
    productInfo: z.object({
      footer_product_info: z.object({
        product_key: z.string().optional(),
      }).optional(),
    }).optional().describe('商品信息（仅图片消息）'),
    // 通用字段
    needOpenComment: z.number().optional().describe('是否开启评论'),
    onlyFansCanComment: z.number().optional().describe('是否仅粉丝可评论'),
    // 列表参数
    offset: z.number().optional().describe('偏移量（列表时使用）'),
    count: z.number().optional().describe('数量（列表时使用）'),
  },
  handler: handleDraftMcpTool,
};