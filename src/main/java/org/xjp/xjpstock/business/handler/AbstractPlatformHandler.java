package org.xjp.xjpstock.business.handler;

import lombok.extern.slf4j.Slf4j;
import org.xjp.xjpstock.business.processor.BusinessProcessor;
import org.xjp.xjpstock.business.strategy.RemoteCallStrategy;

/**
 * @author xujiping
 */
@Slf4j
public abstract class AbstractPlatformHandler<S> {
    public BusinessProcessor<S> businessProcessor;
    public RemoteCallStrategy<S> callStrategy;

    /**
     * 构造器
     **/
    public AbstractPlatformHandler(BusinessProcessor<S> businessProcessor,
                                   RemoteCallStrategy<S> callStrategy) {
        this.businessProcessor = businessProcessor;
        this.callStrategy = callStrategy;
    }

    /**
     * 数据推送模板方法
     *
     * @param originalData 原始数据
     * @return 调用结果
     */
    public <R> R processPush(Object originalData) {
        S data = (S) originalData;

        // 2. 前置处理
        businessProcessor.preProcess(data);

        // 5. 远程调用
        R result = callStrategy.call(data);

        // 7. 后置处理
        businessProcessor.postProcess(data, result);

        return result;
    }


}
