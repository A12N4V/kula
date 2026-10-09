#import <Foundation/Foundation.h>
#import "Util.h"
@interface Greeter : NSObject
- (NSString *)greet;
@end
@implementation Greeter
- (NSString *)greet { return [self helper:@"x"]; }
- (NSString *)helper:(NSString *)s { return upper(s); }
@end
NSString *upper(NSString *s) { return [s uppercaseString]; }
