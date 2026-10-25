/* Conversation tree. A conversation is a set of nodes, each with a parentId;
   a leaf pointer marks the currently active branch. Editing or regenerating a
   message adds a sibling node instead of discarding the old one, so alternative
   branches are preserved and can be navigated. */
(function () {
  function nodeById(c, id) {
    for (var i = 0; i < c.nodes.length; i++) if (c.nodes[i].id === id) return c.nodes[i];
    return null;
  }
  function childrenOf(c, id) {
    return c.nodes.filter(function (n) { return n.parentId === id; })
      .sort(function (a, b) { return a.ts - b.ts; });
  }
  function siblingsOf(c, node) {
    if (!node) return [];
    if (!node.parentId) {
      return c.nodes.filter(function (n) { return !n.parentId; })
        .sort(function (a, b) { return a.ts - b.ts; });
    }
    return childrenOf(c, node.parentId);
  }
  function activePath(c) {
    if (!c || !c.leafId) return [];
    var path = [];
    var cur = nodeById(c, c.leafId);
    var guard = 0;
    while (cur && guard++ < 10000) {
      path.unshift(cur);
      cur = cur.parentId ? nodeById(c, cur.parentId) : null;
    }
    return path;
  }
  function deepestLast(c, node) {
    var cur = node;
    var guard = 0;
    while (guard++ < 10000) {
      var kids = childrenOf(c, cur.id);
      if (!kids.length) break;
      cur = kids[kids.length - 1];
    }
    return cur.id;
  }
  /* Move to the sibling `dir` steps away and return the new leaf id, or null. */
  function switchTo(c, node, dir) {
    var sibs = siblingsOf(c, node);
    var idx = sibs.indexOf(node) + dir;
    if (idx < 0 || idx >= sibs.length) return null;
    return deepestLast(c, sibs[idx]);
  }
  window.SaathiTree = {
    nodeById: nodeById,
    childrenOf: childrenOf,
    siblingsOf: siblingsOf,
    activePath: activePath,
    deepestLast: deepestLast,
    switchTo: switchTo
  };
})();
