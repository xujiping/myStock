package org.xjp.xjpstock.business.processor;


/**
 * @author xujiping
 */
public interface BusinessProcessor<S> {

    /**
     * 前置处理方法
     * 在主处理流程之前执行
     *
     * @param sourceData 输入源数据
     * @return 是否继续后续处理
     */
    default void preProcess(S sourceData) {
    }

    /**
     * 后置处理方法
     * 在主处理流程之后执行
     *
     * @param sourceData 输入源数据
     * @param result     核心处理完成后的结果
     */
    default void postProcess(S sourceData, Object result) {
    }
}
