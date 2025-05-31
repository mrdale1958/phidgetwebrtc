class Queue:
    def __init__(self, maxLength=10):
        self.items = []
        self.maxLength = maxLength

    def isEmpty(self):
        return self.items == []

    def enqueue(self, item):
        self.items.insert(0,item)
        if self.size() > self.maxLength:
            self.dequeue()
    
    def dequeue(self):
        if self.size():
            return self.items.pop()

    def head(self):
        if self.size():
            return self.items[0]
        return(0.0)

    def tail(self):
        if self.size():
            return self.items[self.size()-1]
        return(0.0)

    def size(self):
        return len(self.items)
