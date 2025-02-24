package org.xjp.xjpstock.business.handler;

/**
 * @Author: xujiping
 * @CreateTime: 2025-02-19 17:25
 * @Description: TODO
 */
public interface StreamResponseCallback {

    void onContentReceived(String content);

    void onError(Exception e);

    void onComplete();
}
