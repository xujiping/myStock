package org.xjp.xjpstock.business.handler;

import cn.hutool.core.thread.ThreadUtil;
import cn.hutool.core.util.StrUtil;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.xjp.xjpstock.business.dto.AiChatDto;
import org.xjp.xjpstock.business.entity.Memory;
import org.xjp.xjpstock.business.service.MemoryService;
import org.xjp.xjpstock.business.service.impl.AiPlatformService;
import org.xjp.xjpstock.common.enums.AiPlatformEnum;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@SpringBootTest
class AiPlatformServiceTest {

    @Resource
    private AiPlatformService aiPlatformService;

    @Resource private MemoryService memoryService;

    @Test
    void pushToPlatform() {
        List<Map<String, String>> message = new ArrayList<>();
        message.add(Map.of("role", "assistant", "content", "你是我的个人助理"));
        message.add(Map.of("role", "user", "content", "介绍下深圳"));
        String content = aiPlatformService.pushToPlatform(AiPlatformEnum.DEEPSEEK_CHAT, AiChatDto.builder()
                .messages(message)
                .isSteam(true)
                .callback(new StreamResponseCallback() {
                    @Override
                    public void onContentReceived(String content) {
                        System.out.print(content);
                    }

                    @Override
                    public void onError(Exception e) {
                        e.printStackTrace();
                    }

                    @Override
                    public void onComplete() {
                        System.out.println("\n结束");
                    }
                })
                .build());
        if (StrUtil.isNotBlank(content)){
            System.out.println("非流式回答：" + content);
        }
        ThreadUtil.sleep(100000);
    }

    @Test
    void testDb(){
        Memory memory = new Memory();
        memory.setTitle("测试");
        memoryService.save(memory);
        List<Memory> list = memoryService.list();
        System.out.println(list);
    }
}