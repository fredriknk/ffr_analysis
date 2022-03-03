# -*- coding: utf-8 -*-
"""
Created on Fri May 18 11:50:35 2018

@author: frkl
"""
import sys
import os
import pickle
import numpy as np
import pandas as pd
from os import walk, chdir, getcwd, stat
import tkinter as TK
from tkinter import filedialog
from tkinter import messagebox
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
from time import time
from datetime import datetime
import matplotlib.pyplot as plt
import copy
import datetime as DT
from collections import defaultdict


sys.path.append(os.path.realpath(os.path.join(os.getcwd(), '../../prog')))
from regression import *
import find_regressions
import bisect_find
import utils
import resdir
import csv
import read_regression_exception_list

def slopeFromPoints(reg):
    return [[reg.start, reg.stop], [reg.intercept + reg.start * reg.slope, reg.intercept + reg.stop * reg.slope]]


def datecheck(newdate="2022-01-12 12:03:30", dateFormatList=None):
    """
    Parses a date towards multiple dateformats and stops trying after first success. outputs a datetime object.
    the default date format list is:
    dateFormatList = ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y.%m.%d %H:%M:%S', '%Y.%m.%d', '%y.%m.%d', '%Y-%m-%d',
                      '%Y-%m-%d', '%Y%m%d', '%Y%m']
    """
    if dateFormatList is None:
        dateFormatList = {"%Y-%m-%dT%H:%M:%S",
                          "%Y-%m-%d %H:%M:%S",
                          "%Y.%m.%d %H:%M:%S",
                          "%Y.%m.%d",
                          "%y.%m.%d",
                          "%Y-%m-%d",
                          "%Y-%m-%d",
                          "%Y%m%d",
                          "%Y%m"
                          }

    date = None

    for dateFormat in dateFormatList:
        try:
            date = datetime.strptime(newdate, dateFormat)
            break
        except ValueError:
            pass

    if date == None:
        print("""Parsing error, please use one of theese formats: ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y.%m.%d %H:%M:%S', '%Y.%m.%d', '%y.%m.%d', '%Y-%m-%d',
                      '%Y-%m-%d', '%Y%m%d', '%Y%m'""")
        date = datetime.now()

    return date



class popupWindow(object):
    def __init__(self, master):
        px = 5
        py = 5

        top = self.top = TK.Toplevel(master)

        self.text1 = TK.Label(top, text="Goto #")
        self.text1.grid(row=0, column=0, padx=px, pady=py)
        # self.text1.pack()

        self.gotoNo = TK.Entry(top)
        self.gotoNo.grid(row=0, column=1, padx=px, pady=py)
        # self.entry1.pack()

        self.text2 = TK.Label(top, text="Goto YYYY-MM-DD HH:MM:SS")
        self.text2.grid(row=1, column=0, padx=px, pady=py)
        # self.text2.pack()

        self.datetext = TK.Entry(top)
        self.datetext.grid(row=1, column=1, padx=px, pady=py)
        # self.entry2.pack()

        self.cancel = TK.Button(top, text='Cancel', command=self.cancel)
        self.cancel.grid(row=2, column=1, padx=px, pady=py)

        self.button = TK.Button(top, text='Ok', command=self.cleanup)
        self.button.grid(row=2, column=0, padx=px, pady=py)

        # self.button.pack()

    def cancel(self):
        self.cancel_ = True
        self.top.destroy()

    def cleanup(self):
        self.cancel = False
        self.value = self.gotoNo.get()
        self.date = self.datetext.get()
        self.top.destroy()


class App:

    def __init__(self, master):
        # Create the GUI container

        frame = TK.Frame(master, width=2000, height=2000)
        self.master = master
        self.initializeDF()
        self.maxf = len(self.df)
        self.nr = 1  # measurement number
        self.fname = self.df.iloc[self.nr].filename
        self.xint = 100  # regression window
        self.cutoff = 0.05  # cutoff percentage
        self.method = TK.StringVar(root)  # Variable for radiobox regression method
        self.method.set(self.options["crit"])  # Set default to Mse
        self.CO2_guide = TK.IntVar()
        #        print (self.method)

        row_disp = 0
        ##Buttons for scrolling left rigth
        self.button_left = TK.Button(frame, text="< Prev",
                                     command=self.decrease)
        # Placement of the button with padding around edges
        self.button_left.grid(row=row_disp, column=0, padx=5, pady=5)  # pack( padx=5, pady=5)

        self.button_right = TK.Button(frame, text="GoTo#",
                                      command=self.goto)
        self.button_right.grid(row=row_disp, column=1, padx=5, pady=5)  # .pack( padx=5, pady=5)

        self.button_right = TK.Button(frame, text="Next >",
                                      command=self.increase)
        self.button_right.grid(row=row_disp, column=2, padx=5, pady=5)  # .pack( padx=5, pady=5)

        self.Outs = {}

        graph_unit = " (ppm)"

        row_disp += 1

        label = "CO2"
        name = "CO2 Header"

        self.Outs[name + "label"] = TK.Label(frame, text=label)
        self.Outs[name + "label"].grid(row=row_disp, column=1, padx=5, pady=5)

        label = "N20"
        name = "N20 Header"

        self.Outs[name + "label"] = TK.Label(frame, text=label)
        self.Outs[name + "label"].grid(row=row_disp, column=2, padx=5, pady=5)

        row_disp += 1
        name = "CO2_MUG"
        label = "µG/m²/h"
        self.MakeTextbox(name, label, row_disp, frame, 1)
        name = "N2O_MUG"
        self.MakeTextbox(name, label, row_disp, frame, 2)

        row_disp += 1
        name = "CO2_SLOPE"
        label = "Slope"+graph_unit
        self.MakeTextbox(name, label, row_disp, frame, 1)
        name = "N2O_SLOPE"
        self.MakeTextbox(name, label, row_disp, frame, 2)

        row_disp += 1
        name = "mse_CO2"
        label = "MSE"+graph_unit
        self.MakeTextbox(name, label, row_disp, frame, 1)
        name = "mse_N2O"
        self.MakeTextbox(name, label, row_disp, frame, 2)

        row_disp += 1
        name = "rsq_CO2"
        label = "r² line fit"
        self.MakeTextbox(name, label, row_disp, frame, 1)
        name = "rsq_N2O"
        self.MakeTextbox(name, label, row_disp, frame, 2)

        row_disp += 1
        name = "diff_CO2"
        label = "diff" +graph_unit
        self.MakeTextbox(name, label, row_disp, frame, 1)
        name = "diff_N2O"
        self.MakeTextbox(name, label, row_disp, frame, 2)

        row_disp += 1
        name = "SampleNo"
        label = "graph #"
        self.MakeTextbox(name, label, row_disp, frame, 1)

        row_disp += 1
        name = "airTemp"
        label = "Air Temp"
        self.MakeTextbox(name, label, row_disp, frame)

        row_disp += 1
        name = "side_box"
        label = "Side"
        self.MakeTextbox(name, label, row_disp, frame)

        row_disp += 1
        name = "precip"
        label = "Precip"
        self.MakeTextbox(name, label, row_disp, frame)

        row_disp += 1
        name = "Plot NR"
        label = "Plot NR"
        self.MakeTextbox(name, label, row_disp, frame)

        row_disp += 1
        name = "Treatment NO"
        label = "Treatment NO"
        self.MakeTextbox(name, label, row_disp, frame)

        row_disp += 1
        self.WindowLabel = TK.Label(frame, text="Regr Window")
        self.WindowLabel.grid(row=row_disp, column=0, padx=5, pady=5)
        # tkinter needs special variables it seems like
        self.var = TK.StringVar(root)
        # Init the scrollbox variable to 100 for regression window
        self.var.set(self.options["interval"])
        # initialize scrollbox
        self.XINT = TK.Spinbox(frame, from_=3, to=10000, width=5, increment=1, textvariable=self.var)
        # placement of scrollbox
        self.XINT.grid(row=row_disp, column=1, padx=5, pady=5)

        # Make radiobuttons for
        row_disp += 1
        self.R1 = TK.Radiobutton(frame, text="MSE", variable=self.method, value="mse", command=self.update)
        #        options = ("steepest","mse")
        #        self.R1 = TK.OptionMenu(frame, self.method, *options, command = self.update)
        self.R1.grid(row=row_disp, column=0, padx=5, pady=5)  # Radiobutton for reg method
        #
        self.R2 = TK.Radiobutton(frame, text="Steep", variable=self.method, value='steepest', command=self.update)
        self.R2.grid(row=row_disp, column=1, padx=5, pady=5)  # Radio button for reg method

        row_disp += 1
        self.C1 = TK.Checkbutton(frame, text='CO2 Guide', variable=self.CO2_guide, onvalue=1, offvalue=0, command=self.update)
        self.C1.grid(row=row_disp, column=0, padx=5, pady=5)  # Radio button for reg method

        row_disp += 2
        self.update_button = TK.Button(frame, text="Update",
                                       command=self.update)  # Update the graph
        self.update_button.grid(row=row_disp, column=0)

        self.reset_button = TK.Button(frame, text="Reset Params",
                                      command=self.reset)  # Update the graph
        self.reset_button.grid(row=row_disp, column=2)
        row_disp += 1

        self.set_param = TK.Button(frame, text="Set Default",
                                   command=self.setDefault)  # Update the graph
        self.set_param.grid(row=row_disp, column=2, pady=5)

        row_disp += 1
        self.save = TK.Button(frame, text="Save graph",
                              command=self.saveGraph)  # Update the graph
        self.save.grid(row=row_disp, column=2, pady=40)

        row_disp += 1
        self.save = TK.Button(frame, text="Save all to excel",
                              command=self.toExcel)  # Update the graph
        self.save.grid(row=row_disp, column=2, pady=40)
        row_disp += 1
        #
        self.Outs["CO2_SLOPE"].configure(state="disabled")

        self.fig = Figure(figsize=(15, 10), dpi=80)  # Set the size of plot
        plt.style.use('ggplot')
        self.ax = self.fig.add_subplot(121)
        self.ax1 = self.fig.add_subplot(122)
        # self.ax2 = self.fig.add_subplot(424)
        # self.ax3 = self.fig.add_subplot(426)
        # self.ax4 = self.fig.add_subplot(428)
        self.ax.set_title("CO2")
        self.ax.set_xlabel("Time (s)")
        self.ax.set_ylabel("CO2 (ppm)")
        self.fig.autofmt_xdate()  # Dont know what this does

        self.CO2line1, = self.ax.plot([1, 2], [1, 2], linewidth=1, color="tab:blue",
                                     alpha=0.5)  # Inititalise measurement graph
        self.CO2line2, = self.ax.plot([1, 2], [1, 2], marker='o', linestyle='dashed', linewidth=2, color="tab:green",
                                      alpha=0.7)
        self.CO2line3, = self.ax.plot([1, 2], [1, 2], linewidth=3, color="tab:orange")  # Inititalize regression graph
        self.CO2start, = self.ax.plot([1, 2], [1, 2], linewidth=1, color="tab:red", alpha=0.5)
        self.CO2stop, = self.ax.plot([1, 2], [1, 2], linewidth=1, color="tab:red", alpha=0.5)


        self.N2Oline1, = self.ax1.plot([1, 2], [1, 2], linewidth=1, color="tab:blue", alpha=0.5)
        self.N2Oline2, = self.ax1.plot([1, 2], [1, 2], marker='o', linestyle='dashed', linewidth=2,
                                           color="tab:green", alpha=0.7)  # Inititalize regression graph
        self.N2Oline3, = self.ax1.plot([1, 2], [1, 2], linewidth=3,
                                           color="tab:orange")  # Inititalize regression graph
        self.N2Ostart, = self.ax1.plot([1, 2], [1, 2], linewidth=1, color="tab:red", alpha=0.5)
        self.N2Ostop, = self.ax1.plot([1, 2], [1, 2], linewidth=1, color="tab:red", alpha=0.5)
        
        self.ax1.set_title("N2O")
        self.ax1.set_title("N20")
        self.ax1.set_ylabel("N2O (ppm)")
        self.ax1.set_xlabel("Time (S)")

        self.fig.subplots_adjust(left=0.05, right=0.95, top=0.9, bottom=0.06)
        self.canvas = FigureCanvasTkAgg(self.fig, master=master, )  # Make the canvas
        self.canvas.draw()  # show()#show the canvesRemoved due to breaking update
        self.canvas.get_tk_widget().grid(row=0, column=3, rowspan=9)  # set graph position

        sliderLength = 1000
        self._job = None
        self.sliderMin = TK.Scale(master, from_=0, to=180, length=sliderLength, orient=TK.HORIZONTAL)
        self.sliderMin.bind("<ButtonRelease-1>", self.updateValue)
        self.sliderMin.set(self.options["start"])
        self.sliderMin.grid(row=10, column=3)

        self.sliderMax = TK.Scale(master, from_=0, to=180, length=sliderLength, orient=TK.HORIZONTAL)
        self.sliderMax.bind("<ButtonRelease-1>", self.updateValue)
        self.sliderMax.set(self.options["stop"])
        self.sliderMax.grid(row=11, column=3)

        self.getParams()
        self.update()

        frame.grid(row=0, column=0)
        #
        # self.canvas.pack()
        # self.canvas.bind("<Left>", self.decrease)
        # self.canvas.bind("<Right>", self.increase)

    def initializeDF(self):
        fixpath = utils.ensure_absolute_path
        detailed_output_path = fixpath('output/detailed_regression_output_unsorted')
        find_regressions.make_detailed_output_folders(detailed_output_path)
        self.specific_options_filename = fixpath('specific_options.pickle')
        slopes_filename = fixpath("output/capture_slopes.txt")

        if  ".pickle" in self.specific_options_filename:
            try:
                self.specific_options = read_regression_exception_list.open_pickle_file(self.specific_options_filename)
            except:
                self.specific_options = specific_options
                read_regression_exception_list.save_pickle_file(self.specific_options_filename, specific_options)
        else:
            self.specific_options = read_regression_exception_list.parse_xls_file(self.specific_options_filename)

        self.options = copy.deepcopy(self.specific_options["ALL"])

        self.options_bcp = copy.deepcopy(self.options)

        self.save_options = {'show_images': False,
                             'save_images': False,
                             'save_detailed_excel': False,
                             'sort_detailed_by_experiment': False
                             }

        DATA_FILE_NAME = "raw_data_path.ino"

        try:
            datapath = [open(DATA_FILE_NAME).readlines()[0].strip()]
            resdir.raw_data_path = datapath[0]
        except FileNotFoundError:
            print(DATA_FILE_NAME + ' not found')
            resdir.raw_data_path = fixpath('raw_data')



        malingnr = "1"
        currDir = getcwd()
        # path of measurements

        data_path = "raw_data/"
        df_path = "output/capture_RegressionOutput.xls"

        self.df = pd.read_excel(df_path, index_col=0)

        self.df.date = pd.to_datetime(self.df.date, format="%Y%m%d-%H%M%S")

        self.regr = find_regressions.Regressor(slopes_filename, self.options, self.save_options,
                                               self.specific_options_filename, detailed_output_path)

    def updateValue(self, event):
        self.update()

    def saveGraph(self):
        self.fileSave = TK.filedialog.asksaveasfilename(initialdir=currDir, initialfile=f[self.nr], title="Save Graph",
                                                        filetypes=(("PNG", ".png"), ("all files", "*.*")))
        if self.fileSave == "":
            return
        self.fig.savefig(self.fileSave + ".png")

    def menubar(self, root):
        menubar = TK.Menu(root)
        pageMenu = TK.Menu(menubar)
        pageMenu.add_command(label="PageOne")
        menubar.add_cascade(label="PageOne", menu=pageMenu)
        return menubar

    def toExcel(self):
        self.fileSave = TK.filedialog.asksaveasfilename(initialdir=currDir, title="Save file",
                                                        filetypes=(("Excel File", ".xlsx"), ("all files", "*.*")))

        if self.fileSave == "":
            return

        print("saved: ", str(self.fileSave))
        self.test = []
        nrBcp = self.nr
        self.nr = 0
        for file in f:
            self.getParams()
            self.regress()
            self.di = frames[file].data
            self.test.append(self.di)
            print(frames[f[self.nr]].data)
            self.nr += 1
        self.nr = nrBcp
        self.df = pd.DataFrame(self.test)
        self.writer = pd.ExcelWriter(self.fileSave + ".xlsx")
        self.df.to_excel(self.writer, 'Sheet1')
        self.writer.save()

    def update(self):
        self.xint = int(self.XINT.get())  # Update the regression window
        self.setParams()
        self.replot()  # Replot the graph

    def reset(self):
        # self.xint = int()  # regression window
        #self.var.set(self.specific_options["ALL"]['interval'])
        self.sliderMax.set(self.specific_options["ALL"]["stop"])
        self.sliderMin.set(self.specific_options["ALL"]["start"])
        self.method.set(self.specific_options["ALL"]["crit"])
        if (self.specific_options["ALL"]["co2_guides"] == True):
            self.C1.select()
        else:
            self.C1.deselect()

        if self.fname in self.specific_options:
            del self.specific_options[self.fname]

        self.update()

    def sel2(self):
        self.method.set("steepest")

    def sel1(self):
        self.method.set("mse")

    def getParams(self):
        self.fname = self.df.iloc[self.nr].filename
        if self.fname in self.specific_options.keys():
            name = self.fname
        else:
            name = "ALL"

        self.sliderMin.set(self.specific_options[name]["start"])
        self.sliderMax.set(self.specific_options[name]["stop"])
        self.method.set(self.specific_options[name]['crit'])
        self.xint = self.specific_options[name]["interval"]
        self.var = self.xint
        if (self.specific_options[name]["co2_guides"] == True):
            self.C1.select()
        else:
            self.C1.deselect()
        self.update()


    def setParams(self):
        self.options["start"] = int(self.sliderMin.get())
        self.options["stop"] = int(self.sliderMax.get())
        self.options['crit'] = self.method.get()
        self.options["interval"] = int(self.XINT.get())
        self.options['co2_guides'] = int(self.CO2_guide.get())

        if self.options != self.specific_options["ALL"]:
            self.specific_options[self.fname]= copy.deepcopy(self.options)
            if ".pickle" in self.specific_options_filename:
                with open(self.specific_options_filename, 'wb') as handle:
                    pickle.dump(self.specific_options, handle, protocol=pickle.HIGHEST_PROTOCOL)

    def setDefault(self):
        self.specific_options["ALL"]["start"] = int(self.sliderMin.get())
        self.specific_options["ALL"]["stop"] = int(self.sliderMax.get())
        self.specific_options["ALL"]['crit'] = self.method.get()
        self.specific_options["ALL"]["interval"] = int(self.XINT.get())
        self.specific_options["ALL"]["co2_guides"] = int(self.CO2_guide.get())
        self.getParams()
        self.replot()

    def regress(self):
        self.fname = self.df.iloc[self.nr].filename
        self.df_reg = self.df.iloc[self.nr]

        datafilename = resdir.raw_data_path + "\\" + self.fname
        meas = find_regressions.plot_raw(datafilename)

        self.regressions = self.regr.find_all_slopes(filename_or_data=datafilename, do_plot=False,
                                                     given_specific_options=self.options)

        reg = self.regressions[self.df_reg["side"]]

        self.segments = find_regressions.get_regression_segments(meas, self.regressions)[self.df_reg["side"]]

        self.co2 = meas["CO2"]  # Get the ppm values
        self.N2O = meas["N2O"]
        self.gndTemp = meas['licor_H2O']
        self.EC = meas['licor_T']
        self.VWC = meas['Wind']

        self.name = self.fname
        self.xLen = len(self.co2)

        self.sMin = self.sliderMin.get()
        self.sMax = self.sliderMax.get()

        self.cutStart = int(self.xLen * (self.sMin / 100.))  # Select cut range as 5% of samples
        self.cutStop = int(self.xLen * (self.sMax / 100.))

        self.co2Cut = [[], []]
        self.co2Cut[0] = self.co2[0][self.sliderMin.get():self.sliderMax.get()]
        self.co2Cut[1] = self.co2[1][self.sliderMin.get():self.sliderMax.get()]

        if self.xint >= (self.cutStop - self.cutStart):
            # if the regression window is larger than the sample window after cutting, throw
            # an error box and set the regression window to sample window
            # messagebox.showinfo("ERROR", "regression window is larger than sample window")
            self.xint = (self.cutStop - self.cutStart) - 3
        # Find the best regression

        # Initialize the graph, we first initialize it here, then we update the values in
        # self.replot()

        self.tmpParams = {"start": self.sMin,
                          "stop": self.sMax,
                          "method": self.method.get(),
                          "reg_window": self.xint}

        self.tmpRegression = {"slope": reg["CO2"].slope,
                              "intercept": reg["CO2"].intercept,
                              "mse_CO2": reg["CO2"].mse,
                              "start": reg["CO2"].start,
                              "stop": reg["CO2"].stop,
                              "diff_CO2": reg["CO2"].max_y - reg["CO2"].min_y
                              }

        return reg

    def replot(self):
        reg = self.regress()

        # Update all of the text boxes
        self.UpdateText("SampleNo", self.nr)
        self.UpdateText("CO2_MUG", str("%.2e" % (reg["CO2"].slope * flux_units["CO2"]["factor"])))
        self.UpdateText("N2O_MUG", str("%.2e" % (reg["N2O"].slope * flux_units["N2O"]["factor"])))
        self.UpdateText("CO2_SLOPE", str("%.2e" %(reg["CO2"].slope)))
        self.UpdateText("N2O_SLOPE", str("%.2e" %(reg["N2O"].slope)))
        self.UpdateText("mse_CO2", str("%.2e" %(reg["CO2"].mse)))
        self.UpdateText("mse_N2O", str("%.2e" %(reg["N2O"].mse)))
        self.UpdateText("rsq_CO2", str("%.2f" %(reg["CO2"].rsq)))
        self.UpdateText("rsq_N2O", str("%.2f" %(reg["N2O"].rsq)))
        self.UpdateText("diff_CO2", str("%.2e" %(reg["CO2"].max_y - reg["CO2"].min_y)))
        self.UpdateText("diff_N2O", str("%.2e" %(reg["N2O"].max_y - reg["N2O"].min_y)))
        self.UpdateText("side_box", self.df_reg["side"])
        self.UpdateText("airTemp", self.df_reg["Tc"])
        self.UpdateText("precip", self.df_reg["precip"])
        self.UpdateText("Plot NR", self.df_reg["nr"])
        self.UpdateText("Treatment NO", self.df_reg["treatment"])

        # Update all of the plot lines
        self.title = (self.name +
                      "\n" + str(self.tmpRegression) + "\n" +
                      "AirTemp: %.1f degC     GroundTemp: %.1f degC         EC: %.3f          VWC: %.3f" %
                      (1,
                       2,
                       3,
                       4))
        slopeSegments = self.segments["CO2"]
        slopeLine = slopeFromPoints(reg["CO2"])

        self.fig.suptitle(self.title, fontsize=12)
        self.CO2line1.set_xdata(slopeSegments[0])
        self.CO2line1.set_ydata(slopeSegments[1])  # Update sample values
        self.CO2line2.set_xdata(slopeSegments[2])
        self.CO2line2.set_ydata(slopeSegments[3])
        self.CO2line3.set_xdata(slopeLine[0])  # Update regression values
        self.CO2line3.set_ydata(slopeLine[1])  # Update regression values

        self.CO2start.set_xdata([self.options["start"]]*2)
        self.CO2start.set_ydata([np.min(slopeSegments[1]), np.max(slopeSegments[1])])
        self.CO2stop.set_xdata([self.options["stop"]]*2)
        self.CO2stop.set_ydata([np.min(slopeSegments[1]), np.max(slopeSegments[1])])

        slopeSegments = self.segments["N2O"]
        slopeLine = slopeFromPoints(reg["N2O"])

        self.N2Oline1.set_xdata(slopeSegments[0])
        self.N2Oline1.set_ydata(slopeSegments[1])  # Update sample values
        self.N2Oline2.set_xdata(slopeSegments[2])
        self.N2Oline2.set_ydata(slopeSegments[3])
        self.N2Oline3.set_xdata(slopeLine[0])  # Update regression values
        self.N2Oline3.set_ydata(slopeLine[1])  # Update regression values

        self.N2Ostart.set_xdata([self.options["start"]] * 2)
        self.N2Ostart.set_ydata([np.min(slopeSegments[1]), np.max(slopeSegments[1])])
        self.N2Ostop.set_xdata([self.options["stop"]] * 2)
        self.N2Ostop.set_ydata([np.min(slopeSegments[1]), np.max(slopeSegments[1])])
        #
        # self.gndTempLine1.set_xdata(self.gndTemp[0])
        # self.gndTempLine1.set_ydata(self.gndTemp[1])
        # #
        # # self.gndTempLine2.set_xdata(self.envXCUT)
        # # self.gndTempLine2.set_ydata(self.gndTempCut)
        #
        # self.ECLine1.set_xdata(self.EC[0])
        # self.ECLine1.set_ydata(self.EC[1])
        # #
        # # self.ECLine2.set_xdata(self.envXCUT)
        # # self.ECLine2.set_ydata(self.ECCut)
        #
        # self.VWCLine1.set_xdata(self.VWC[0])
        # self.VWCLine1.set_ydata(self.VWC[1])

        # self.VWCLine2.set_xdata(self.envXCUT)
        # self.VWCLine2.set_ydata(self.VWCCut)

        self.ax.relim()  # Set the limits from the values to be graphed
        self.ax.autoscale_view()  # Autoscale to limits
        self.ax1.relim()  # Set the limits from the values to be graphed
        self.ax1.autoscale_view()  # Autoscale to limits
        # self.ax2.relim()  # Set the limits from the values to be graphed
        # self.ax2.autoscale_view()  # Autoscale to limits
        # self.ax3.relim()  # Set the limits from the values to be graphed
        # self.ax3.autoscale_view()  # Autoscale to limits
        # self.ax4.relim()  # Set the limits from the values to be graphed
        # self.ax4.autoscale_view()  # Autoscale to limits

        self.canvas.draw()  # Draw the figure

    def goto(self):
        self.w = popupWindow(self.master)
        self.master.wait_window(self.w.top)
        if not self.w.cancel:
            print(self.w.value, self.w.date)
            newnr = self.w.value
            newdate = self.w.date
            if newnr:
                newnr = int(newnr)
                if newnr >= 0 and newnr <= (len(self.df) - 1):
                    self.nr = newnr
                    self.getParams()
                    self.replot()
            elif newdate:
                date = datecheck(newdate)
                self.nr = abs((date - df['date'])).idxmin()
                self.replot()
                self.update()

    def decrease(self):
        # If the measurement counter is above zero, increment with one
        if self.nr > 0:
            self.nr -= 1
            self.getParams()
            self.replot()

    def increase(self):
        # If the measurement counter is below number of measurements, becrement with one
        if self.nr < self.maxf - 1:
            self.nr += 1
            self.getParams()
            self.replot()

    def UpdateText(self, name, value):
        self.Outs[name].configure(state="normal")
        # update the slope textbox
        self.Outs[name].delete(1.0, 15.0)
        self.Outs[name].insert(1.0, value)
        self.Outs[name].configure(state="disabled")

    def MakeTextbox(self, name, label, row_disp, frame, collumnbox=1, collumntext=0, state="disabled", width=9):
        self.Outs[name + "label"] = TK.Label(frame, text=label)
        self.Outs[name + "label"].grid(row=row_disp, column=collumntext, padx=5, pady=5)
        # Regression slope text display
        self.Outs[name] = TK.Text(frame, height=1, width=width)
        # Placement of regression text display
        self.Outs[name].grid(row=row_disp, column=collumnbox, padx=5, pady=5)
        self.Outs[name].configure(state=state)  # Disable to prevent user input


if __name__ == "__main__":
    flux_units = {'N2O': {'name': 'N2O_N_mug_m2h', 'factor': 2 * 14 * 1e6 * 3600},
                  'CO2': {'name': 'CO2_C_mug_m2h', 'factor': 12 * 1e6 * 3600}}

    specific_options = {
        "ALL": {
            'interval': 100,
            'start': 0,
            'stop': 180,
            'crit': 'steepest',
            'co2_guides': True,
            'correct_negatives': False
        }
    }

root = TK.Tk()
app = App(root)
root.mainloop()
