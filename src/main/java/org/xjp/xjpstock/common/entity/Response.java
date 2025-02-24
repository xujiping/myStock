package org.xjp.xjpstock.common.entity;

import cn.hutool.core.util.StrUtil;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;
import org.slf4j.helpers.MessageFormatter;

import java.io.Serial;
import java.io.Serializable;

/**
 * @Author: xujiping
 * @CreateTime: 2024-11-27 16:25
 * @Description: TODO
 */
@Data
public class Response<T> implements Serializable {

    @Serial
    private static final long serialVersionUID = 1715303334259361695L;

    private boolean status = false;
    private String code;
    private String msg;
    protected T data;
    private String traceId;

    /**
     * @deprecated
     */
    @Deprecated
    public boolean isStatus() {
        return this.status;
    }

    @JsonIgnore
    public boolean isSuccess() {
        return this.status;
    }

    @JsonIgnore
    public boolean isFailure() {
        return !this.status;
    }

    public static Response<?> succeed() {
        return of(RespType.SUCCESS);
    }

    public static <T> Response<T> succeed(T data) {
        return of(RespType.SUCCESS, data, (String) null);
    }

    public static <T> Response<T> error() {
        return of(RespType.BUSINESS_ERROR, (String) null);
    }

    public static <T> Response<T> error(String msgPattern, Object... argArray) {
        return of(RespType.BUSINESS_ERROR, msgPattern, argArray);
    }

    public static <T> Response<T> of(IRespType type) {
        return of(type, (String) null);
    }

    public static <T> Response<T> of(IRespType type, String msgPattern, Object... argArray) {
        return of(type, null, msgPattern, argArray);
    }

    public static <T> Response<T> of(IRespType type, T data, String msgPattern, Object... argArray) {
        String msg;
        if (StrUtil.isBlank(msgPattern)) {
            msg = type.getMessage();
        } else {
            msg = MessageFormatter.arrayFormat(msgPattern, argArray).getMessage();
        }

        Response<T> response = new Response();
        response.setCode(type.getCode());
        response.setMsg(msg);
        response.setStatus(type.isSuccess());
        response.setData(data);
        return response;
    }
}
