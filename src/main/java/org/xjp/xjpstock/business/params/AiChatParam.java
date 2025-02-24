package org.xjp.xjpstock.business.params;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollUtil;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;

import java.io.Serial;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * @Author: xujiping
 * @CreateTime: 2025-02-20 11:24
 */
@Slf4j
@Data
public class AiChatParam implements Serializable {
    @Serial
    private static final long serialVersionUID = -1096100506579783477L;

    /**
     * 大模型
     */
    private String aiPlatform;

    /**
     * 对话消息列表
     */
    private List<AiMessageParam> messages;

    public List<Map<String, String>> messageToMapList() {
        List<Map<String, String>> mapList = new ArrayList<>();
        if (CollUtil.isEmpty(messages)) {
            return mapList;
        }
        try {
            List<Map<String, Object>> list = messages.stream().map(BeanUtil::beanToMap).toList();
            // 遍历外层列表
            for (Map<String, Object> inputMap : list) {
                Map<String, String> outputMap = new HashMap<>();
                // 遍历内层 Map 的键值对
                for (Map.Entry<String, Object> entry : inputMap.entrySet()) {
                    String key = entry.getKey();
                    Object value = entry.getValue();
                    // 将值转换为字符串
                    String stringValue = (value != null) ? value.toString() : null;
                    outputMap.put(key, stringValue);
                }
                mapList.add(outputMap);
            }
            return mapList;
        } catch (Exception e) {
            log.error("转换数据失败", e);
            return mapList;
        }

    }

}
