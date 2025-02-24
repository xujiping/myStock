package org.xjp.xjpstock.business.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;

/**
 * @Author: xujiping
 * @CreateTime: 2025-02-20 16:01
 * @Description: TODO
 */
@Data
@AllArgsConstructor
public class AiExplainDto implements Serializable {
    @Serial
    private static final long serialVersionUID = 1443205636011588769L;

    /**
     * 数据是否经过处理
     */
    private boolean explained = false;

    private String message;
}
