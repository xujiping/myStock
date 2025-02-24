package org.xjp.xjpstock.business.strategy;

/**
 * 远程调用策略接口
 * @author xujiping
 */
public interface RemoteCallStrategy<S> {

    /**
     * 发起远程调用（非加密）
     * @param paramData 非加密请求参数
     * @return 调用结果
     */
    <R> R call(S paramData);

}
