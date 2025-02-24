package org.xjp.xjpstock.business.params;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;

/**
 * @Author: xujiping
 * @CreateTime: 2025-02-20 11:26
 * @Description: TODO
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class AiMessageParam implements Serializable {
    @Serial
    private static final long serialVersionUID = -4858679752273005865L;

    private String role;

    private String content;
}
