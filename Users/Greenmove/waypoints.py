import csv
import matplotlib.pyplot as plt
import numpy as np
import math
import numpy as np
from shapely.geometry import MultiPoint,Polygon
from shapely.ops import unary_union, nearest_points
from shapely.affinity import rotate, translate

"""
Library for making the rectangle from a group of measurements.

"""

class WaypointData:
    def __init__(self, csv_file, expand = [0,0]):
        self.csv_file = csv_file
        self.expand = expand
        self.coordinates = self._load_coordinates()
        self.rectangle, self.center = self.create_rectangle()

    def _load_coordinates(self):
        coordinates = []
        with open(self.csv_file, 'r') as file:
            reader = csv.reader(file)
            next(reader)  # Skip header row
            for row in reader:
                x = float(row[0])
                y = float(row[1])
                z = float(row[2])
                angle = float(row[3])
                waypoint_type = row[4]
                side = row[5]
                waypoint_number = row[6]
                coordinates.append((x, y, z, angle, waypoint_type, side, waypoint_number))
        return coordinates

    def get_bounding_box_coordinates(self):
        measure_points = [coord for coord in self.coordinates if coord[4] == 'Measure']
        min_x = min(point[0] for point in measure_points)
        max_x = max(point[0] for point in measure_points)
        min_y = min(point[1] for point in measure_points)
        max_y = max(point[1] for point in measure_points)
        return min_x, max_x, min_y, max_y

    def get_aligned_bounding_box_coordinates(self):
        measure_points = [coord for coord in self.coordinates if coord[4] == 'Measure']
        outer_points = [(point[0], point[1]) for point in measure_points]

        # Find the closest rectangle coordinates
        closest_coords = self.find_closest_rectangle_coordinates(outer_points)

        #sort them
        aligned_bbox_coords = self.sort_points(closest_coords)

        return aligned_bbox_coords

    def sort_points(self,points):
        # Find the point with the lowest y, and in case of a tie, the lowest x
        min_point = min(points, key=lambda point: (point[1], point[0]))

        # Sort the points so that the point with the lowest y and x coordinate is first
        points.sort(key=lambda point: (point[1], point[0]))

        # Then sort by angle while keeping the point with lowest y and x first
        points = points[0:1] + sorted(points[1:],
                                      key=lambda point: math.atan2(point[1] - min_point[1], point[0] - min_point[0]))

        return points

    def find_closest_rectangle_coordinates(self, points):
        # Find the indices of minimum and maximum points
        min_x_idx = np.argmin([point[0] for point in points])
        max_x_idx = np.argmax([point[0] for point in points])
        min_y_idx = np.argmin([point[1] for point in points])
        max_y_idx = np.argmax([point[1] for point in points])

        # Sort the indices in ascending order
        indices = sorted([min_x_idx, max_x_idx, min_y_idx, max_y_idx])

        # Reorder the points based on the sorted indices
        rectangle_coords = [points[idx] for idx in indices]

        return rectangle_coords

    def create_rectangle(self, points = None, expand = None):
        if not expand:
            expand = self.expand
        if not points:
            measure_points = [coord for coord in self.coordinates if coord[4] == 'Measure']
            points = [(point[0], point[1]) for point in measure_points]

        # Create a multipoint object
        mpoint = MultiPoint(points)

        # Compute the convex hull of the points
        hull = mpoint.convex_hull

        # Get the points of the convex hull
        hull_points = list(hull.exterior.coords)

        min_angle = None
        min_rect = None
        min_area = float("inf")

        # For each edge of the hull
        for i in range(len(hull_points) - 1):
            # Get the points of the edge
            p1, p2 = hull_points[i], hull_points[i + 1]

            # Compute the angle of the edge
            edge_angle = np.arctan2(p2[1] - p1[1], p2[0] - p1[0])

            # Rotate the hull to align the edge with the x axis
            rotated_hull = rotate(hull, -edge_angle, origin=p1, use_radians=True)

            # Compute the bounding box of the rotated hull
            minx, miny, maxx, maxy = rotated_hull.bounds

            # Compute the area of the bounding box
            area = (maxx - minx) * (maxy - miny)

            # If the area is smaller than the previous minimum, update the minimum
            if area < min_area:
                min_angle = edge_angle
                min_rect = (minx, miny, maxx, maxy)
                min_area = area

        # Create the minimum bounding rectangle
        minx, miny, maxx, maxy = min_rect
        #delta = 0  # or whatever amount you want to add to height and width
        delta_x=expand[1]
        delta_y=expand[0]
        rect_points = [(minx - delta_x / 2, miny - delta_y / 2),
                       (maxx + delta_x / 2, miny - delta_y / 2),
                       (maxx + delta_x / 2, maxy + delta_y / 2),
                       (minx - delta_x / 2, maxy + delta_y / 2)]
        rect = Polygon(rect_points)
        print(rect)

        # Rotate and translate the rectangle to its original orientation and location
        rect = rotate(rect, min_angle, origin=(minx, miny), use_radians=True)
        p1, p2 = nearest_points(rect.centroid, hull.centroid)
        rect = translate(rect, p2.x - p1.x, p2.y - p1.y)

        return [tuple(point) for point in rect.exterior.coords[:-1]], rect.centroid

    def visualize_waypoints(self, show_rotation=False):
        colors = {
            'Measure': 'blue',
            'DriveThrough': 'green',
            'TurningPoint': 'red',
            'Stop': 'orange'
        }
        x_vals = [coord[0] for coord in self.coordinates]
        y_vals = [coord[1] for coord in self.coordinates]
        waypoint_types = [coord[4] for coord in self.coordinates]

        fig, ax = plt.subplots()
        ax.scatter(x_vals, y_vals, c=[colors[waypoint_type] for waypoint_type in waypoint_types])

        # Add waypoint numbers as text labels to the plot
        for i, coord in enumerate(self.coordinates):
            ax.text(coord[0], coord[1], str(i + 1))

        if show_rotation:
            for i, coord in enumerate(self.coordinates):
                x, y, angle = coord[0], coord[1], coord[3]
                dx = np.cos(angle)
                dy = np.sin(angle)
                ax.arrow(x, y, dx, dy, color=colors[waypoint_types[i]], length_includes_head=True, head_width=0.2)

        aligned_bbox_coords = self.get_aligned_bounding_box_coordinates()
        ax.set_aspect('equal', 'box')
        ax.set_xlabel('X')
        ax.set_ylabel('Y')
        ax.set_title('Waypoint Visualization')
        ax.grid(True)

        # Draw aligned bounding box
        poly = plt.Polygon(aligned_bbox_coords, linewidth=1, edgecolor='r', facecolor='none')
        ax.add_patch(poly)
        expanded_polygon, _ = self.create_rectangle()
        polyExp = plt.Polygon(expanded_polygon, linewidth=1, edgecolor='g', facecolor='none')
        ax.add_patch(polyExp)

        plt.show()

    def get_ffr_rect(self):
        x = []
        y = []
        for point in self.rectangle:
            x.append(point[0])
            y.append(point[1])
        return [x,y]



# Example usage
csv_file = 'truesoilCorrected.csv'
# csv_file = 'capture.csv'

field_width = 12
field_length = 2.5
drive_track = 2.4

waypoint_data = WaypointData(csv_file,expand = [field_width*2+drive_track,field_length])
waypoint_data.visualize_waypoints(show_rotation=True)
print(waypoint_data.center)
