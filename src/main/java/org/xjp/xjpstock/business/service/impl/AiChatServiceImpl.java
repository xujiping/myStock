package org.xjp.xjpstock.business.service.impl;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.xjp.xjpstock.business.dto.AiChatDto;
import org.xjp.xjpstock.business.dto.AiExplainDto;
import org.xjp.xjpstock.business.params.AiChatParam;
import org.xjp.xjpstock.business.params.AiMessageParam;
import org.xjp.xjpstock.business.service.AiChatService;
import org.xjp.xjpstock.business.service.MemoryService;
import org.xjp.xjpstock.common.enums.AiPlatformEnum;
import reactor.core.publisher.FluxSink;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * @Author: xujiping
 * @CreateTime: 2025-02-20 11:22
 * @Description: TODO
 */
@Slf4j
@Service
public class AiChatServiceImpl implements AiChatService {

    @Resource
    private AiPlatformService aiPlatformService;

    @Resource
    private MemoryService memoryService;

    @Override
    public String chatWithNonStream(AiChatParam aiChatParam) {
        // todo 对消息做前置处理
        List<AiMessageParam> messages = aiChatParam.getMessages();
        List<AiMessageParam> userList = messages.stream().filter(s -> "user".equals(s.getRole())).toList();
        String lastMessage = userList.get(messages.size() - 1).getContent();
        AiExplainDto explain = explain(lastMessage);
        if (explain.isExplained()) {
            return explain.getMessage();
        }
        return aiPlatformService.pushToPlatform(AiPlatformEnum.getEnumByCode(aiChatParam.getAiPlatform()), AiChatDto.builder()
                .isSteam(false)
                .messages(aiChatParam.messageToMapList())
                .build());
    }

    @Override
    public void chatWithStream(AiChatParam aiChatParam, FluxSink<String> sink) {
        // todo 流式回答
    }

    @Override
    public AiExplainDto explain(String message) {
        log.info("开始解析消息：" + message);
        String promptStr = "\n" +
                "请根据如下任务要求，完成一个简单的消息结构化处理程序，将后续的消息进行分类处理，输出结构化数据。\n" +
                "\n" +
                "【任务目标】\n" +
                "1. 判断用户消息是否需要记忆存储\n" +
                "2. 需要记忆的消息自动解析为结构化数据\n" +
                "3. 其他消息返回无需处理\n" +
                "\n" +
                "【分类规则】\n" +
                "✅ 需要记忆的消息类型：\n" +
                "① 消费账单：包含金额的消费记录\n" +
                "- 特征词：花了/消费/支付/买了 + 金额数字\n" +
                "- 示例：\"买了本书58元\"\"交通费花了12.5\"\n" +
                "\n" +
                "② 个人备忘：需要记录的事实性信息\n" +
                "- 特征词：记录/记住/我的XX是\n" +
                "- 示例：\"我的护照号E123456\"\"记录生日是5月20日\"\n" +
                "\n" +
                "❌ 不需要记忆的消息：\n" +
                "• 日常对话：\"你好\"\"在吗\"\n" +
                "• 提问咨询：\"怎么坐地铁？\"\n" +
                "• 情感表达：\"今天好开心！\"\n" +
                "• 模糊描述：\"买了些东西\"\n" +
                "\n" +
                "【处理规范】\n" +
                "1. 结构化格式：\n" +
                "- 账单类：\n" +
                "{\n" +
                "  \"category\": \"账单\",\n" +
                "  \"detail\": {\n" +
                "    \"date\": \"系统自动填充今日日期（YYYY-MM-DD）\",\n" +
                "    \"type\": \"餐饮/购物/交通/医疗/教育/其他\",\n" +
                "    \"title\": \"消费项目简称（如：早餐/图书）\",\n" +
                "    \"money\": \"数字金额（保留两位小数）\",\n" +
                "    \"originalWords\": \"用户原话（需完整保留）\"\n" +
                "  }\n" +
                "}\n" +
                "\n" +
                "\n" +
                "- 备忘类：\n" +
                "{\n" +
                "  \"category\": \"备忘录\",\n" +
                "  \"detail\": {\n" +
                "    \"date\": \"系统自动填充今日日期\",\n" +
                "    \"title\": \"关键事实摘要（如：护照号/宠物名字）\",\n" +
                "    \"originalWords\": \"用户原话\"\n" +
                "  }\n" +
                "}\n" +
                "\n" +
                "\n" +
                "2. 处理原则：\n" +
                "- 金额必须包含货币单位前的数字\n" +
                "- 日期字段始终使用系统当前日期\n" +
                "- 原话字段必须完整保留用户原始输入\n" +
                "- 无法明确分类时保持消息原样\n" +
                "\n" +
                "【错误预防】\n" +
                "❗ 禁止以下情况：\n" +
                "1. 对非消费信息添加money字段\n" +
                "2. 擅自修改用户原始表述\n" +
                "3. 对疑问句进行结构化处理\n" +
                "4. 将非事实性信息归入备忘录\n" +
                "\n" +
                "【响应示例】\n" +
                "用户输入：午餐外卖38元\n" +
                "AI响应：\n" +
                "{\n" +
                "  \"category\": \"账单\",\n" +
                "  \"detail\": {\n" +
                "    \"date\": \"2023-10-25\",\n" +
                "    \"type\": \"餐饮\",\n" +
                "    \"title\": \"午餐外卖\",\n" +
                "    \"money\": \"38.00\",\n" +
                "    \"originalWords\": \"午餐外卖38元\"\n" +
                "  }\n" +
                "}\n" +
                "\n" +
                "\n" +
                "用户输入：记得我的身份证有效期到2030年\n" +
                "AI响应：\n" +
                "{\n" +
                "  \"category\": \"备忘录\",\n" +
                "  \"detail\": {\n" +
                "    \"date\": \"2023-10-25\",\n" +
                "    \"title\": \"身份证有效期\",\n" +
                "    \"originalWords\": \"记得我的身份证有效期到2030年\"\n" +
                "  }\n" +
                "}";
        List<Map<String, String>> messages = new ArrayList<>();
        messages.add(Map.of("role", "assistant", "content", promptStr));
        messages.add(Map.of("role", "user", "content", message));
        String response = aiPlatformService.pushToPlatform(AiPlatformEnum.DEEPSEEK_CHAT, AiChatDto.builder()
                .isSteam(false)
                .messages(messages)
                .build());
        log.info("解析结果：" + response);
        if ("[END]".equals(response)) {
            return new AiExplainDto(false, response);
        }
        // todo 处理数据
        memoryService.handler(response);
        return new AiExplainDto(false, "好的，我记住了");
    }
}
