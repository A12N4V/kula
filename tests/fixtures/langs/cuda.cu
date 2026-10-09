#include <cuda.h>
__global__ void kernel(float *x) { x[0] = helper(x[0]); }
__device__ float helper(float v) { return v; }
class Grid { void run(); };
int main() { kernel<<<1,1>>>(0); launch(); }
