.class public Lcom/demo/Greeter;
.super Ljava/lang/Object;
.method public greet()Ljava/lang/String;
    .registers 2
    invoke-virtual {p0}, Lcom/demo/Greeter;->helper()Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method
.method public helper()Ljava/lang/String;
    .registers 1
    const-string v0, "x"
    return-object v0
.end method
