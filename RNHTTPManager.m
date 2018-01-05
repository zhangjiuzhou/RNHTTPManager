//
//  RNHTTPManager.m
//  RNHTTPManager
//
//  Created by 张九州 on 17/1/16.
//

#import "RNHTTPManager.h"
#import <CHTTPManager/CHTTPManager.h>

@interface RNHTTPManager ()

@property (nonatomic, strong) NSMutableDictionary *taskMap;

@end

@implementation RNHTTPManager

RCT_EXPORT_MODULE();

- (instancetype)init
{
    self = [super init];
    if (self) {
        self.taskMap = [NSMutableDictionary dictionary];
    }
    return self;
}

#pragma mark - export methods

RCT_EXPORT_METHOD(request:(NSString *)URL
                   options:(NSDictionary *)options
               tokenBlock:(RCTResponseSenderBlock)tokenBlock)
{
    CHTTPRequestParams *requestParams = [CHTTPRequestParams fromDictionary:options];
    PMKPromise *promise = [CHTTPManager requestWithURL:URL params:requestParams];
    NSURLSessionTask *task = promise.http_task;
    NSInteger taskID = returnValue.http_taskID;
    [self.taskMap setObject:task forKey:@(taskID)];

    tokenBlock(@[@(taskID)]);

    __weak typeof(self) weakSelf = self;
    promise.then(^(id responseObject) {
        __strong typeof(self) strongSelf = weakSelf;
        [strongSelf _onSuccess:responseObject task:task taskIdentifier:taskID];
    }).catch(^(NSError *error) {
        __strong typeof(self) strongSelf = weakSelf;
        [strongSelf _onError:error task:task taskIdentifier:taskID];
    });
}

RCT_EXPORT_METHOD(cancelRequest:(NSUInteger)token)
{
    NSURLSessionTask *task = [self.taskMap objectForKey:@(token)];
    if (task) {
        [task cancel];
    }
}

#pragma mark - overide

- (dispatch_queue_t)methodQueue
{
    return dispatch_get_main_queue();
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[
           @"onSuccess",
           @"onError",
           @"onProgress"
           ];
}

#pragma mark - private methods

- (void)_onSuccess:(id)responseObject task:(NSURLSessionTask *)task taskIdentifier:(long long)taskIdentifier
{
    [self.taskMap removeObjectForKey:@(taskIdentifier)];
    NSHTTPURLResponse *response = (NSHTTPURLResponse *)task.response;
    [self sendEventWithName:@"onSuccess" body:@{
                                              @"token": @(taskIdentifier),
                                              @"response": @{
                                                  @"data": responseObject ? : [NSNull null],
                                                  @"statusCode": @(response.statusCode)
                                                  },
                                              }];
}

- (void)_onError:(NSError *)error task:(NSURLSessionTask *)task taskIdentifier:(long long)taskIdentifier
{
    [self.taskMap removeObjectForKey:@(taskIdentifier)];
    NSHTTPURLResponse *response = (NSHTTPURLResponse *)task.response;
    [self sendEventWithName:@"onError" body:@{
                                            @"token": @(taskIdentifier),
                                            @"response": @{
                                                @"error": @{
                                                    @"type":error.domain,
                                                    @"code":@(error.code),
                                                    @"message":error.localizedDescription ? : [NSNull null]
                                                },
                                                @"statusCode": @(response.statusCode)
                                            }}];
}

@end
