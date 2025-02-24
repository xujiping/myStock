package org.xjp.xjpstock.business.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.xjp.xjpstock.business.handler.StreamResponseCallback;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * @Author: xujiping
 * @CreateTime: 2025-02-19 11:33
 * @Description: TODO
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiChatDto implements Serializable {

    @Serial
    private static final long serialVersionUID = -3728103867111369866L;

    private boolean isSteam = false;

    /**
     * 用户聊天信息
     */
    private List<Map<String, String>> messages;

    /**
     * 流式数据回调
     */
    private StreamResponseCallback callback;

}
