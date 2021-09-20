"""Utilities to make, plot, move, rotate and divide rectangles and
 other 4-polygons (maybe other polygons also).

Used for defining and plotting the geometry of the plots in E22.

A 4-gon (for example a rectangle) is internally represented by the corners as
[[x1, x2, x3, x4], [y1, y2, y3, y4]]

p = Polygon([0,1,1,0], [10,10,14,11])
plt.cla()
p.rotate(.3, 0)
p.plot(color="green")
plt.scatter(*p.points()[0])
plt.scatter(*p.points()[1], marker='s')
d = p.divide_rectangle(3, gaps=(0,.1,0), other_way=True)
plot_rectangles(d, "0 1 2 3 4 5 6 7 8".split())
for r in d:
    plt.scatter(*r.points()[0])
    plt.scatter(*r.points()[1], marker='s')

def test_point(x,y):
    plt.scatter(x,y)
    for (i, r) in enumerate(d):
        if r.contains(x,y):
            print(i)

test_point(.3, 10.5)

"""
from plotting_compat import plt
import numpy as np

# todo maybe make Rectangle subclass of Polygon, but this
# also works.
class Polygon(object):
    """
    These are equivalent and make a rectangle with width
    1 and height 2 with lower left corner in (0,0).
    p = Polygon([0,1,1,0], [0,0,2,2])
    p = Polygon([(0,0), (1,0), (1,2), (0,2)])
    p = Polygon(0, 0, W=1, L=1)
    """
    def __init__(self, x, y=None, W=None, L=None):
        if isinstance(x, (int, float)):
            assert(isinstance(y, (int, float)))
            self._make_rectangle(x, y, W, L)
        elif isinstance(x[0], (tuple, list, np.ndarray)):
            self.x = np.array([x[0] for x in x])
            self.y = np.array([x[1] for x in x])
        else:
            self.x = np.array(x)*1.0
            self.y = np.array(y)*1.0
        assert(len(self.x) == len(self.y))
        
    def points(self):
        return [ np.array((self.x[i], self.y[i])) 
                 for i in range(len(self.x)) ]
    
    def copy(self):
        return Polygon(self.x, self.y)
    
    def rotate(self, angle, about=0):
        """about is the point the polygon is rotated about, and can be 1) a
        pair [x,y] of coordinates, 2) an integer (zero based) representing
        which coner to rotate about, or 3) 'center' or 'c'
        
        example: 
        
        p = Polygon([5, 10 , 10, 5], [0, 0, 1, 1]], np.pi/4, 1) )
        % rotates 45 degrees about (10, 0) 
        r = p.copy().rotate(np.pi/4, 1)
        % rotates 45 degrees about center point
        r = p.copy().rotate(np.pi/4, 'c')
    """
        x, y = self.x, self.y
        if about in ('center', 'c'):
            about = (x.mean(), y.mean())
        elif isinstance(about, int):
            about = (x[about], y[about])
        x -= about[0]
        y -= about[1]
        s = np.sin(angle)
        c = np.cos(angle)
        x1 = x * c - y * s + about[0]
        y1 = x * s + y * c + about[1]
        self.x = x1
        self.y = y1
        return self

    def move(self, x, y):
        self.x += x
        self.y += y
        return self
    

    def _make_rectangle(self, x0, y0, W, L):
        self.x = np.array([0, W, W, 0]) + x0
        self. y = np.array([0, 0, L, L]) + y0
        

    def divide_rectangle(self, n, other_way=False, gaps=(0,0,0)):
        """Divides the rectangle
    
          p2 --- p1     
          |       |
          p3 --- p0
      
        (possibly rotated) into n equal rectangles. If other_way is
        false, new points are inserted between p0 and p1, and p3 and
        p2.  If gaps are not all zero, there will be gaps like so (for
        n = 2):
            
            p2     p1 
              gaps[2]
            r2 --- r1
            |       |
            r3 --- r0 
              gaps[1]
            q2 --- q1 
            |       |
            q3 --- q0 
              gaps[0]
            p3     p0  
        
        gaps[1] is repeated if n>2.
        Actually, it doesn't need to be a rectangle, just a 4-gon
        """
        
        p = self.points()
        if other_way:
            p = [p[-1], p[0], p[1], p[2]]
        unitv1 = (p[1] - p[0])/np.linalg.norm(p[1]-p[0])
        unitv2 = (p[2] - p[3])/np.linalg.norm(p[2]-p[3])
        p[0] += unitv1*gaps[0]
        p[3] += unitv2*gaps[0]
        p[1] -= unitv1*gaps[0]
        p[2] -= unitv2*gaps[0]
        L1 = np.linalg.norm(p[1]-p[0])
        l1 = (L1+gaps[1])/n
        L2 = np.linalg.norm(p[2]-p[3])
        l2 = (L2+gaps[1])/n
        p0s = np.array([p[0] + unitv1*l1*i for i in range(n)])
        p1s = p0s + (l1-gaps[1])*unitv1
        p3s = np.array([p[3] + unitv2*l2*i for i in range(n)])
        p2s = p3s + (l2-gaps[1])*unitv2
        print(p0s)
        print(p1s)
        print(p2s)
        print(p3s)
        if other_way:
            p0s, p1s, p2s, p3s = p1s, p2s, p3s, p0s
        return [Polygon((p0s[i], p1s[i], p2s[i], p3s[i])) for i in range(n)]        
        
            
    def plot(self, text=None, textkwargs= {}, **kwargs):
        x, y = self.x, self.y
        #todo callable .... sometimes before I made this a class I called 
        # plot_rectangle on  something which wasn't rectangle, but a function
        if not 'color' in kwargs:
            kwargs['color'] = 'k'
        plt.plot(list(x) + [x[0]], list(y) + [y[0]], **kwargs)
        if not 'fontsize' in textkwargs.keys():
            textkwargs['fontsize'] = 8
        if not(text is None):
            x, y = self.midpoint()
            plt.text(x, y, text, **textkwargs)

    def midpoint(self):
        return self.x.mean(), self.y.mean()

    def __repr__(self):
        return "Polygon with\n x = {}\n y = {}".format(self.x, self.y)
    

    def contains(self, x, y):
        """ return True if a point is inside the polygon, otherwise False"""
    # http://www.ariel.com.au/a/python-point-int-poly.html
    # determine if a point is inside a given polygon or not
        poly = self.points()
        n = len(poly)
        inside = False
        p1x, p1y = poly[0]
        for i in range(n + 1):
            p2x, p2y = poly[i % n]
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or x <= xinters:
                            inside = not inside
            p1x, p1y = p2x, p2y
        return inside

    


def plot_rectangles(rectangles, names=True, textkwargs={}, **kwargs):
    """rectangles can be a dict or a list of rectangles. If rectangles is
a dict and names==True, the keys are usesd as names. names may also be
a list"""
    assert(isinstance(rectangles, (dict, list)))
    if isinstance(rectangles, dict):
        pairs = [(key, rectangles[key]) for key in list(rectangles)]
        rectangles = [x[1] for x in pairs]
        if names is True:
            names = [x[0] for x in pairs]
    else:
        if names is True:
            names = range(1, len(rectangles)+1)
    for i, r in enumerate(rectangles):
        r.plot(text=None if not names else names[i],
               textkwargs=textkwargs,
               **kwargs)
    




# Old stuff, keeping it in case

# def combine_adjacent_rectangles_of_equal_size(rectangle_list):
#     ### ummm I'll take the midpoint of all... no. The two furthest
#     ### points, then the owwww. Find smallest rectangle that covers
#     ### all points. Google. Convex hull, of course. Generalize? Later
#     r = np.concatenate([np.array(r) for r in rectangle_list], axis=1)
#     #return convex_hull(r.transpose()) no, that's too sensitive

def combine_adjacent_rectangles_of_equal_size(rectangle_list):
    # in case they are not arrays
    rectangle_list = [np.array(r) for r in rectangle_list]
    # [[x,y], [x, y], ....]
    points = np.concatenate(rectangle_list, axis=1).transpose()
    midpoint = points.mean(axis=0)
    dists = [[np.linalg.norm(p - midpoint), i] for i, p in enumerate(points)]
    indexes = [x[1] for x in sorted(dists[:4], reverse=True)]
    # got the four points, now I have to make sure they don't cross
    return np.array(convex_hull(points[indexes])[:-1]).transpose()


def convex_hull(points):
    """from Mike Loukides at
    https://www.oreilly.com/ideas/an-elegant-solution-to-the-convex-hull-problem

    """
    def split(u, v, points):
        # return points on left side of UV
        return [p for p in points if np.cross(p - u, v - u) < 0]

    def extend(u, v, points):
        if not points:
            return []

        # find furthest point W, and split search to WV, UW
        w = min(points, key=lambda p: np.cross(p - u, v - u))
        p1, p2 = split(w, v, points), split(u, w, points)
        return extend(w, v, p1) + [w] + extend(u, w, p2)

    # find two hull points, U, V, and split to left and right search
    u = min(points, key=lambda p: p[0])
    v = max(points, key=lambda p: p[0])
    left, right = split(u, v, points), split(v, u, points)

    # find convex hull on each side
    return [v] + extend(u, v, left) + [u] + extend(v, u, right) + [v]


# fast enough so far:
def find_polygon(x, y, polygons):
    """ return index of the first polygon (in a list of polygons) containing (x,y).
    return -1 if (x,y) is not inside any of the polygons."""
    for (i, r) in enumerate(polygons):
        if r.contains(x, y):
            return i
    return -1

def plot_rectangles_old(rectangles, names=True):
    """rectangles can be a dict or a list of rectangles. If rectangles is
a dict and names==True, the keys are usesd as names. names may also be
a list"""

    if isinstance(rectangles, dict):
        pairs = [(key, rectangles[key]) for key in list(rectangles)]
        rectangles = [x[1] for x in pairs]
        if names is True:
            names = [x[0] for x in pairs]
    not_plottable = 0
    for i, r in enumerate(rectangles):
        not_plottable += plot_rectangle(r,
                                        text=None if not names else names[i])
    if not_plottable:
        print('%d non-plottable rectangle-functions' % not_plottable)
    # plt.axis('equal')
    # plt.axis('equal') gives me problems when I forget to unset it for later plots
    # (with axis('auto')), so:
    if any([callable(x) for x in rectangles]):
        return
    xx = [p[0] for p in r for r in rectangles]
    yy = [p[1] for p in r for r in rectangles]
    xlims = [min(xx), max(xx)]
    ylims = [min(yy), max(yy)]
    xd = max(xlims) - min(xlims)
    yd = max(ylims) - min(ylims)
    if xd > yd:
        ycenter = (ylims[0] + ylims[1]) / 2
        ylims = [ycenter - xd / 2, ycenter + xd / 2]
    else:
        xcenter = (xlims[0] + xlims[1]) / 2
        xlims = [xcenter - yd / 2, xcenter + yd / 2]
    plt.plot(xlims, ylims, 'w.')


